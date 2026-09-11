# 秒回 MiaoHui → LumiLuna 扩展包移植计划（v2：独立扩展分发）

> 目标：把纯本地离线「内容搜索引擎」MiaoHui（照片/截图/录屏/视频的逐帧画面、OCR 文字、语音全部可一句话语义检索）作为**独立扩展包**接入 LumiLuna（Tauri v2 + Vue 3），**不打包进主项目**。
> 本计划基于参考项目 `图片视频索引项目参考/` 的真实代码结构，以及 LumiLuna 现有架构（`commands/ffmpeg.rs`、`webdav.rs`、`lib.rs`、`src/capabilities/index.ts`、已开启的 `assetProtocol` scope=`["**"]`、已授权的 `global-shortcut`/`opener`）制定。

---

## 0. 结论变更（相对 v1）

| v1（已废弃） | v2（本方案） |
|---|---|
| Python 引擎打包进主项目 `resources/`，随主安装包分发 | **主项目零增加**；引擎+模型(~500MB+)只在用户主动安装该扩展时才下载 |
| 搜索 UI 编译进主前端 `SearchView.vue` | 扩展自带预构建 web UI，主机用 `asset://` 加载 |
| 命令写死在 `generate_handler!` | 主机只暴露**通用扩展桥接命令** `ext_invoke`，路由到扩展引擎 |
| 热键/托盘逻辑写死在主程序 | 主机读扩展 `manifest.json` 的 `contributes`，**集中代注册** |

**核心思路**：给 LumiLuna 增加一套**扩展框架（extension host）**，MiaoHui 成为第一个、也是参考实现级的扩展包。扩展框架一次性的、可复用（以后任何锦上添花的功能都能照此分发）。MiaoHui 的 `core/` 引擎逻辑仍**原样复用**（Python sidecar + localhost HTTP），OCR 统一为 RapidOCR(ONNX) 跨平台。

---

## 1. 扩展框架设计（host 侧，核心新增）

### 1.1 目录与生命周期
- 扩展根：`app_data_dir/extensions/<ext_id>/`
  - `manifest.json`：扩展元数据 + 引擎入口 + 贡献点（见 §1.3）
  - `engine/`：扩展私有引擎（MiaoHui 的 Python sidecar）
  - `web/dist/`：扩展预构建前端（静态 HTML/JS/CSS）
  - `data/`：扩展私有数据（index.db / hnsw / audit / models，由引擎写）
- 启动发现：`lib.rs` 的 `.setup` 扫描 `extensions/` 目录 → 读各 `manifest.json` → 对每个**已启用**扩展：拉起引擎 sidecar、注册其 window/tray/hotkey、挂载 web 路由。
- 安装/卸载/启用在运行时经 `ext_install`/`ext_uninstall`/`ext_enable`/`ext_disable` 完成，无需重启主程序即可启用（重启后由发现流程兜底）。

### 1.2 通用桥接命令（编译期固定，路由到扩展）
新增 `src-tauri/src/commands/extension.rs`，全部 `pub async fn` + `spawn_blocking`（遵守主线程不阻塞约定）：
- `ext_list() -> Vec<ExtInfo>`：已安装扩展清单（含 enabled / engine_ready / 状态）
- `ext_install(source: ExtSource)`：`ExtSource = { kind:"folder"|"url"|"zip", path/url }` → 校验 manifest → 解压/复制 → `extensions/<id>/`
- `ext_uninstall(id)`：停引擎（如有）→ 删目录
- `ext_set_enabled(id, enabled)`：启/停引擎 + 注册/注销 window/tray/hotkey
- `ext_invoke(id, method, payload: Json) -> Json`：**核心路由**——按 `<id>` 找到已拉起的引擎 sidecar，HTTP `POST 127.0.0.1:<port>/<method>`（reuse `webdav.rs` 的 OnceLock 端口持有 + `ffmpeg.rs` 的 `CREATE_NO_WINDOW` 拉起）
- 事件：`app.emit("ext://<id>/<event>", payload)`（如 `ext://miaohui/index-progress`、`ext://miaohui/models-progress`）

### 1.3 扩展 manifest 规范（`manifest.json`）
```json
{
  "id": "miaohui",
  "name": "秒回 · 内容检索",
  "version": "0.1.0",
  "author": "Kian0034 (移植)",
  "license": "MIT",
  "minHostVersion": "2.0.0",
  "engines": {
    "cmd": "engine/python_engine",
    "args": ["--service"],
    "supportEnv": "MIAOHUI_SUPPORT_DIR",
    "readyLine": "READY <port>"
  },
  "web": { "dist": "web/dist", "defaultRoute": "search" },
  "contributes": {
    "windows": [{ "route": "search", "title": "内容检索",
                  "width": 760, "height": 520, "alwaysOnTop": true, "decorations": false }],
    "hotkeys": [{ "accelerator": "Ctrl+Alt+Space", "route": "search", "action": "toggle" }],
    "tray": [
      { "id": "search",  "title": "内容搜索", "action": "open:search" },
      { "id": "reindex", "title": "重建索引", "action": "invoke:index_full" }
    ],
    "settings": { "schema": [ { "key":"roots", "type":"paths" },
                              { "key":"sensitive_protection","type":"bool","default":true },
                              { "key":"asr_enabled","type":"bool","default":true },
                              { "key":"ocr_enabled","type":"bool","default":true } ] }
  },
  "permissions": ["opener:open-path", "fs:read:ext", "ext:invoke"]
}
```
主机解析 `contributes`：window 用**单一共享 `extension` 窗口**按 `?ext=<id>&route=<route>` 加载；hotkey/tray 由主机**代注册**（主机已有 `global-shortcut` / tray 权限，扩展不直接申请），触发时调 `ext_invoke` 或 `open:route`。

### 1.4 权限与 capability（关键设计）
- **不依赖动态生成 capability**：Tauri v2 的 capability 是静态 JSON，不支持运行时新增标签。
- 解法：所有扩展 UI 复用**一个预授权窗口 label `extension`**（在 `src-tauri/capabilities/extension.json` 中声明 `windows:["extension"]`，授予 `core:default` + `opener:*` + `fs:allow-read-file`(scope 限 `extensions/**`) + `ext:*`(主机 ext 命令) + `event:listen`）。扩展窗口经 `?ext=<id>` 区分。
- 高权限操作（打开文件、跳秒）由**主机代执行**：扩展经 `ext_invoke` 请求，主机用已授权的 `opener` 插件 / `std::process::Command` 完成——扩展本身不持有关键权限，缩小信任面。
- `global-shortcut` 由主机统一注册（读 manifest `contributes.hotkeys`），扩展只声明组合键。

### 1.5 扩展 web UI 加载
- 主机 `extension` 窗口加载 `convertFileSrc(extDir/web/dist/index.html)` → `asset://.../index.html`（主项目 `assetProtocol` scope 已为 `["**"]`，无需改配置）。
- 扩展前端用极薄桥接层调主机：封装 `window.__TAURI__.core.invoke("ext_invoke", {id:"miaohui", method, payload})` + `listen("ext://miaohui/...")`。MiaoHui 扩展的 web UI 可单独用 Vite 构建，与主前端解耦。

---

## 2. MiaoHui 扩展包（guest 侧，改造原项目）

仓库结构（独立分发，自带 LICENSE）：
```
miaohui-extension/
├── manifest.json
├── engine/                # = 原 core/ 精简 + service.py
│   ├── core/  (config/db/embed/search/security/ocr/asr/frames/scanner/pipeline/bootstrap)
│   ├── service.py         # --service 起 localhost HTTP，读 READY <port>
│   └── requirements-win.txt / linux.txt
├── web/                   # 预构建前端（Vite build → dist/）
│   └── dist/index.html + assets
├── models/                # 运行时下载（不进包）
└── LICENSE (MIT) + NOTICE
```

改造要点：
- `core/config.py`：支持 `MIAOHUI_SUPPORT_DIR` 环境变量（主机注入 `extensions/miaohui/data`）。
- **OCR 统一 RapidOCR(ONNX) 跨平台**：`core/ocr.py` 去掉 macOS Apple Vision 分支，全平台走 RapidOCR（捆绑 PyInstaller Python 不便带 pyobjc，单代码路径更稳）。
- `service.py` 新增：stdlib `http.server` 暴露 `POST /search`(body `{q,limit}`)、`POST /index`(`{mode}`)、`GET /index/status`、`GET /models/status`、`POST /models/ensure`、`POST /settings`；返回结构同原 `SearchService`（`results:[{id,score,path,kind,ts,dur,ocr,asr,thumb_b64}], latency_ms, breakdown, index_size`）。缩略图由 `security.dec` 解密后 base64 返回。
- 模型下载复用 `core/bootstrap.py`（hf-mirror，三个仓库，~500MB 运行时拉），进度经 `GET /models/status` + 事件回传。

---

## 3. 分阶段实施

### Phase 0 — 许可隔离
- 扩展包自带 `LICENSE`(MIT 全文) + `NOTICE`（注明移植自 `github.com/Kian0034/miaohui`）。主项目 GPL-3.0 不变，二者独立，互不影响。
- `core/security.py` 等文件顶部补 MIT 头。

### Phase 1 — 扩展框架（host，核心）
- `src-tauri/src/commands/extension.rs`：`ext_list`/`ext_install`(folder|url|zip，校验 manifest + 可选 checksum)/`ext_uninstall`/`ext_set_enabled`/`ext_invoke` + 端口持有(OnceLock) + 引擎拉起(`std::process::Command`+`CREATE_NO_WINDOW`+读 stdout `READY <port>`)。
- `lib.rs`：加 `pub mod commands::extension;`，`generate_handler!` 注册，`.setup` 跑扩展发现流程（扫描 `extensions/`、拉起已启用引擎、emit 就绪）。
- `src-tauri/capabilities/extension.json`：`windows:["extension"]` 授予 core/opener/fs(ext 范围)/ext/event。
- 单一 `extension` 窗口的创建/路由(`?ext=&route=`)逻辑；`tray.rs` 预留「扩展」菜单挂载点；`global-shortcut` 注册入口（读 manifest contributes）。

### Phase 2 — MiaoHui 改造为扩展包（guest）
- 建 `miaohui-extension/`：复制 `core/` → `engine/core/`；写 `service.py`(HTTP 端点)；`ocr.py` 统一 RapidOCR；写 `manifest.json`；web UI 用 Vite 构建到 `web/dist/`。
- **本地验收门**：`python engine/service.py --service` → `curl localhost:<port>/search -d '{"q":"白色显卡开箱"}'` 返回 JSON、<0.3s。

### Phase 3 — 主机↔扩展桥接
- `ext_invoke` → sidecar HTTP（reqwest blocking 在 spawn_blocking 内）；后台线程轮询 `/index/status` → `emit("ext://miaohui/index-progress")`；模型下载进度同理。
- 前端极薄桥接：封装 `extInvoke(id, method, payload)` + `onExtEvent(id, event, cb)`（走 `safeInvoke` 思路，非 Tauri 可 mock）。

### Phase 4 — 热键 / 托盘（主机代注册）
- 主机读 `manifest.contributes.hotkeys` 用 `global-shortcut` 注册 `Ctrl+Alt+Space` → toggle `extension?ext=miaohui&route=search`。
- 主机读 `contributes.tray` 在 `tray.rs` 注入菜单项（搜索/重建索引/暂停），触发走 `ext_invoke` 或 `open:route`。

### Phase 5 — 扩展管理 UI（主项目内）
- 新增「扩展」面板（主窗口内 `ExtensionsView.vue` 或设置页）：已安装列表（启用开关/版本/状态）、安装（选文件夹或填 URL/上传 zip）、卸载、模型下载进度条。
- 安装即触发 `ext_install` → 解压 → 启用 → 拉起引擎。

### Phase 6 — 打开 / 视频跳秒（主机代执行）
- 扩展请求 `ext_invoke("miaohui","open",{path,ts})` → 主机：图片走 `opener.open_path`；视频 `ts` 命中 `std::process::Command` 拉 mpv(`--start=`)/PotPlayer(`/seek=`)，找不到则默认播放器；`reveal` 走 `opener.reveal_item_in_dir`。

### Phase 7 — 单独打包与分发（不进主项目 release）
- 扩展包构建：引擎 PyInstaller 按目标产出 onedir（`win-x64`/`win-arm64`/`linux-x64`/`linux-arm64`/`mac-x64`/`mac-arm64`），放 `engine/bin/<target>/`；web UI 单独 `vite build`。
- 扩展包打成 **独立 .zip**（manifest + engine + web/dist + LICENSE），发到独立仓库/release 或用户手动放置 `extensions/miaohui/`。
- **主项目 release 体积零增加**；macOS 公证仅扩展包需面对（延后）。

---

## 4. 组件映射表

| MiaoHui 原组件 | v2 落点 |
|---|---|
| `core/*` 引擎 | `miaohui-extension/engine/core/`（原样） |
| `app_win/panel.py` | `miaohui-extension/web/dist/` 预构建 UI，主机 `extension` 窗口加载 |
| `app_win/hotkey.py` | 主机读 manifest 代注册 `global-shortcut` |
| `app_win/tray.py` | 主机 `tray.rs` 读 manifest 注入菜单 |
| `app_win/opener.py` | 主机 `ext_invoke("open")` 代执行（opener/mpv） |
| `main.py --search` | `service.py --service` + `POST /search` |

---

## 5. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 主项目体积 | **零增加**：引擎+模型仅随扩展包分发，运行时下载 |
| 扩展框架复杂度 | 一次性投入，可复用给其他扩展；MiaoHui 即参考实现 |
| Tauri capability 动态性 | 单一 `extension` 窗口 + 静态 `extension.json` 预授权，规避动态标签 |
| 扩展 web UI 加载 | `assetProtocol` scope=`["**"]` 已开，`convertFileSrc` 直接可用 |
| 第三方扩展信任面 | 主机代执行高权限操作；manifest 校验 + 可选 checksum；文档提示用户自担风险 |
| OCR 跨平台 | 统一 RapidOCR(ONNX)，去 Apple Vision 分支 |
| 密钥/旧缩略图兼容 | `security.py` 留扩展包内原样（Keychain/DPAPI + `nonce(12)+ct`） |
| 主线程阻塞 | `ext_invoke` 走 `spawn_blocking`，遵守既有范式 |
| 许可隔离 | 扩展包自带 MIT LICENSE+NOTICE；主项目 GPL-3.0 不变 |

---

## 6. 验收标准
1. 主项目 release **不含** MiaoHui 引擎/模型；`app_data_dir/extensions/` 为空时主程序正常。
2. 把 `miaohui-extension/` 放进 `extensions/miaohui/`（或经「扩展」面板安装）→ 重启/启用后，`Ctrl+Alt+Space` 弹出检索窗口。
3. 输入即返回结果（<0.3s）、Enter 打开原文件、视频跳精确秒；索引进度实时反映在托盘/设置。
4. 首次模型下载有进度反馈；敏感目录默认排除并写 `audit.jsonl`。

## 7. 工作量估算
- Phase 1（扩展框架）：**中等偏大**，是本次新增的核心，但一次性、可复用。
- Phase 2（MiaoHui 改扩展包）：中等，引擎零风险，主要是 `service.py` + manifest + web UI 构建。
- Phase 3–6：小～中等（桥接/热键/管理 UI/打开跳秒）。
- Phase 7：中等，仅扩展包 CI/打包。
- 总工期：聚焦投入数周；主项目本身改动克制、风险低。
