#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MiaoHui 扩展包引擎：localhost HTTP 服务（被 LumiLuna 主机拉起）。

握手：绑定 127.0.0.1:0，打印 `READY <port>` 到 stdout，主机读取后把
`ext_invoke(id, method, payload)` 路由到 `POST 127.0.0.1:<port>/<method>`。

端点：
  POST /search        {q, limit?}        -> core.search.SearchService.search
  POST /index         {mode?}            -> 后台启动 core.pipeline.run
  GET  /index/status  -> pipeline.read_state()
  GET  /models/status -> {ready, modeling}
  POST /models/ensure -> 后台下载模型（hf-mirror）
  POST /settings      {key:value}        -> 持久化设置

注意：`open` 由主机拦截（高权限动作主机代执行），不在此处理。
"""
import json
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from core import config, bootstrap  # noqa: E402

SEARCH_LIMIT = 30
_INDEX_LOCK = threading.Lock()
_MODEL_LOCK = threading.Lock()
_MODELING = False
_index_proc: subprocess.Popen | None = None  # type: ignore[type-arg]

FROZEN = getattr(sys, "frozen", False)


def _do_search(payload):
    import base64
    from core.search import SearchService

    payload = payload or {}
    q = payload.get("q", "")
    limit = int(payload.get("limit", SEARCH_LIMIT) or SEARCH_LIMIT)
    if not q or not str(q).strip():
        return {"results": [], "latency_ms": 0, "breakdown": {}, "index_size": 0}
    try:
        res = SearchService().search(str(q), limit=limit)
    except Exception as e:  # 检索失败不应让 HTTP 500 阻断体验
        return {"results": [], "latency_ms": 0, "breakdown": {},
                "index_size": 0, "error": str(e)}
    # thumb 是解密后的 JPEG 字节，JSON 无法序列化 → base64（方案书 §2）
    for r in res.get("results", []):
        t = r.get("thumb")
        if isinstance(t, (bytes, bytearray)):
            r["thumb"] = base64.b64encode(bytes(t)).decode("ascii")
        elif t:
            r["thumb"] = None
    return res


def _start_index():
    """按原项目进程模型起索引子进程（pipeline.run 里 signal.signal 只能主线程）。"""
    global _index_proc
    with _INDEX_LOCK:
        if _index_proc is not None and _index_proc.poll() is None:
            return {"ok": True, "already_running": True}
        # 源码模式: python -m core.pipeline；冻结模式: python_engine --index-worker
        cmd = ([sys.executable, "--index-worker"] if FROZEN
               else [sys.executable, "-m", "core.pipeline"])
        kwargs: dict = {}
        if sys.platform == "win32" and hasattr(subprocess, "CREATE_NO_WINDOW"):
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
        try:
            _index_proc = subprocess.Popen(
                cmd, cwd=str(ROOT) if not FROZEN else None,
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, **kwargs)
        except Exception as e:  # noqa: BLE001
            _index_proc = None
            return {"ok": False, "error": str(e)}
        return {"ok": True}


def _index_running() -> bool:
    return _index_proc is not None and _index_proc.poll() is None


def _ensure_models():
    global _MODELING
    with _MODEL_LOCK:
        if _MODELING:
            return
        _MODELING = True
    try:
        bootstrap.ensure_async()
    finally:
        with _MODEL_LOCK:
            _MODELING = False


class _Handler(BaseHTTPRequestHandler):
    def _send(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", 0) or 0)
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw or b"{}")
        except Exception:
            return {}

    def do_GET(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        if path == "/index/status":
            from core import pipeline
            st = pipeline.read_state()
            st["running"] = _index_running()
            self._send(st)
        elif path == "/models/status":
            self._send({"ready": bootstrap.models_ready(), "modeling": _MODELING})
        else:
            self._send({"error": "not found"}, 404)

    def do_POST(self):
        path = self.path.split("?", 1)[0].rstrip("/") or "/"
        payload = self._read_json()
        # ext_invoke 统一走 POST，故状态查询端点在 POST 下同样可用
        if path == "/index/status":
            from core import pipeline
            st = pipeline.read_state()
            st["running"] = _index_running()
            self._send(st)
            return
        if path == "/models/status":
            self._send({"ready": bootstrap.models_ready(), "modeling": _MODELING})
            return
        try:
            if path == "/search":
                self._send(_do_search(payload))
            elif path == "/index":
                mode = (payload or {}).get("mode", "full")
                result = _start_index()
                result["mode"] = mode
                self._send(result)
            elif path == "/models/ensure":
                threading.Thread(target=_ensure_models, daemon=True).start()
                self._send({"ok": True})
            elif path == "/settings":
                s = config.load_settings()
                allowed = {"roots", "sensitive_protection", "asr_enabled",
                           "ocr_enabled", "indexing_paused"}
                s.update({k: v for k, v in (payload or {}).items()
                          if k in allowed})
                config.save_settings(s)
                self._send({"ok": True, "settings": s})
            else:
                self._send({"error": "not found"}, 404)
        except Exception as e:  # noqa: BLE001
            self._send({"error": str(e)}, 500)

    def log_message(self, *a):  # 静音默认访问日志
        pass


def main():
    config.ensure_dirs()
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    port = server.server_address[1]
    # 关键握手行：主机读取后才会把调用路由进来
    sys.stdout.write(f"READY {port}\n")
    sys.stdout.flush()
    sys.stderr.write(f"[miaohui-engine] listening on 127.0.0.1:{port}\n")
    server.serve_forever()


if __name__ == "__main__":
    main()
