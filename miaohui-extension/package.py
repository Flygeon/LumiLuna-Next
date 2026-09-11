#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""MiaoHui 扩展包打包脚本（独立分发，不进 LumiLuna 主项目 release）。

用法：
  python package.py            # 产出 dist/miaohui-extension-<version>-py.zip
                               # （Python 源码模式，用户机器需有 Python 3.10+）

冻结模式（可选，二选一）：
  先用 PyInstaller 在各目标平台产出 onedir 引擎：
    pyinstaller --name python_engine --onedir engine/service.py \
                --collect-all rapidocr_onnxruntime --collect-all cv2 ...
  把 onedir 放到 engine/bin/，然后：
    python package.py --frozen
  产出 dist/miaohui-extension-<version>-<platform>.zip（manifest 的
  engines.cmd 会被改写为 python_engine，用户机器无需 Python）。

包内容：manifest.json + engine/ + web/dist/ + LICENSE + NOTICE + README.md
不含：models/（运行时下载）、data/（用户数据）、__pycache__、构建产物。
"""
import argparse
import json
import re
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXCLUDE_DIRS = {"__pycache__", "models", "data", "build", "dist", "dist_pkg",
                ".git", "engine_bin"}
EXCLUDE_SUFFIX = {".pyc", ".pyo"}


def version() -> str:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    return manifest.get("version", "0.0.0")


def stage(dst: Path, frozen: bool) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    dst.mkdir(parents=True)
    for item in ROOT.iterdir():
        if item.name in EXCLUDE_DIRS or item.name in {"package.py"}:
            continue
        if item.is_file():
            shutil.copy2(item, dst / item.name)
        elif item.is_dir():
            shutil.copytree(item, dst / item.name,
                            ignore=shutil.ignore_patterns(
                                *[f"*{s}" for s in EXCLUDE_SUFFIX],
                                "__pycache__", "models", "data"))
    if frozen:
        # 冻结模式：manifest.cmd 指向 PyInstaller 产物（host 自动补 .exe）
        mf = dst / "manifest.json"
        text = mf.read_text(encoding="utf-8")
        text = re.sub(r'"cmd"\s*:\s*"[^"]*"',
                      '"cmd": "engine_bin/python_engine"', text, count=1)
        mf.write_text(text, encoding="utf-8")
        if not (dst / "engine_bin").exists():
            print("警告：未找到 engine_bin/（PyInstaller onedir 应放这里），"
                  "包仍会生成但引擎无法拉起", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--frozen", action="store_true",
                    help="打包 PyInstaller onedir 引擎（engine_bin/）")
    args = ap.parse_args()

    ver = version()
    tag = "frozen" if args.frozen else "py"
    out_dir = ROOT / "dist_pkg"
    out_dir.mkdir(exist_ok=True)
    stage_dir = out_dir / "miaohui-extension"
    stage(stage_dir, args.frozen)
    zip_path = out_dir / f"miaohui-extension-{ver}-{tag}.zip"
    if zip_path.exists():
        zip_path.unlink()
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in sorted(stage_dir.rglob("*")):
            if p.is_file():
                zf.write(p, p.relative_to(stage_dir.parent))
    shutil.rmtree(stage_dir)
    print(f"打包完成：{zip_path}")
    print("安装方式：LumiLuna「扩展」面板选择该 zip，或解压到 "
          "%APPDATA%/com.lumiluna.app/extensions/miaohui/")


if __name__ == "__main__":
    main()
