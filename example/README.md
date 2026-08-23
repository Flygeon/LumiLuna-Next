# LumiLuna 示例皮肤（Example Skins）

本目录存放皮肤系统的示例与测试皮肤，**不随应用构建打包**——想体验请自行下载文件，然后在应用里导入：

- **拖拽导入**：把 `.json` 或 `.zip` 文件直接拖到应用窗口任意位置；
- **按钮导入**：设置 → 外观 → 皮肤 → 「导入皮肤」选择文件。

皮肤装坏界面时，用 `--safe-mode` 参数启动即可在默认主题下恢复。

## 皮肤清单

| 文件 | 格式 | 名称 | 演示内容 |
|------|------|------|----------|
| `skins/lumiluna.mono-ink.json` | v1 | 墨 | 纯结构化令牌：黑白灰去彩色 |
| `skins/lumiluna.roundify.json` | v1 | 圆角狂想 | 种子色适配（`seedColor: true`）+ 圆角/动效令牌 |
| `skins/lumiluna.midnight.json` | v1 | 午夜 | 单模式（`modes: ["dark"]`）：AMOLED 纯黑 + 自动锁定深色 |
| `skins/lumiluna.md1.json` | v1 | Material Design 1 | 全量令牌 + 任意 CSS：2014 初代 Material 复刻 |
| `skins/lumiluna.sakura.zip` | **v2** | 樱小路露娜 | **v2 三合一测试**：背景图片（浅/深双模式遮罩）+ SVG 图标包（导航九图标）+ 布局令牌（104px 侧栏 / 增强毛玻璃） |

`lumiluna.sakura/` 目录是 v2 皮肤的**源文件**（`skin.json` + `assets/`），供皮肤作者参考；`.zip` 是打包好可直接导入的产物。

## 皮肤开发

- 格式与能力说明：`doc/皮肤开发指南.md`
- 系统设计：`doc/皮肤系统开发方案书.md`（v1）、`doc/皮肤系统v2开发方案书.md`（v2）

### v2 ZIP 结构速览

```
my-skin.zip
├── skin.json              ← formatVersion: 2，必须位于根
└── assets/
    ├── bg-light.jpg       ← background.light.image 引用
    └── icons/             ← icons.mode = "svg" 时的逐名图标目录
        └── home.svg         （文件名 = Material Symbols 图标名）
```

限制：条目 ≤ 200、解压总量 ≤ 50 MB、单文件 ≤ 10 MB（字体 ≤ 5 MB）；`skin.json` 内引用的资源必须存在于包内；远程引用（http/https）导入时会列出清单请你确认。
