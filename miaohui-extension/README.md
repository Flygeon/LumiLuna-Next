# MiaoHui 扩展包（LumiLuna）

「秒回」离线内容检索引擎的 LumiLuna 扩展包：把照片/截图/录屏/视频的每帧画面、
OCR 文字、语音变成可一句话语义检索的索引，输入如「白色显卡开箱」即可命中并
跳回原文件/原视频精确时间点。全程本地算力，断网可用。

移植自 [Kian0034/miaohui](https://github.com/Kian0034/miaohui)（MIT），
OCR 统一为 RapidOCR(ONNX)，GUI/托盘/热键由 LumiLuna 扩展框架（主机）代管。

## 安装

方式一（推荐）：LumiLuna「扩展」面板 → 安装 → 选择 `miaohui-extension-*.zip`。
方式二（手动）：解压到 `%APPDATA%/<LumiLuna>/extensions/miaohui/`，重启 LumiLuna。

## 首次使用

1. 启用扩展后按 `Ctrl+Alt+Space` 呼出检索窗口。
2. 首次需「下载模型」（约 500MB，走 hf-mirror 国内镜像，进度见状态栏）。
3. 点「重建索引」开始扫描默认目录（Downloads/Desktop/Videos/Documents/Pictures）；
   索引目录、敏感目录保护、ASR/OCR 开关可在扩展设置中调整。

## 隐私模型

- 零网络检索引擎；唯一联网动作是首次模型下载（镜像站）。
- 敏感目录/文件（密码、钱包、证件、密钥类）默认不索引，动作写 `data/audit.jsonl`。
- 缩略图 AES-256-GCM 加密（Windows DPAPI / macOS 钥匙串），存 `data/index.db`。

## 开发

- 引擎：`engine/service.py`（localhost HTTP，`READY <port>` 握手）。
- 源码模式运行：`pip install -r requirements.txt` 后 `python engine/service.py --service`。
- 打包分发：`python package.py`（源码 zip）或 PyInstaller 冻结后 `python package.py --frozen`。
- 上游协议：`POST /search|/index|/models/ensure|/settings`、
  `GET|POST /index/status|/models/status`。

## 许可

MIT（见 LICENSE）。移植变更说明见 NOTICE。LumiLuna 主项目（GPL-3.0）与本扩展包相互独立。
