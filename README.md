# LumiLuna · 光影媒体库

<div align="center">

**All-in-one media management app** — browse, organize and play **images, videos, music and e-books (EPUB/PDF)** in one desktop app.

[English](README.md) ｜ [简体中文](README_zh.md)

</div>

LumiLuna is built on **Tauri 2 + Vue 3 + TypeScript + Material Design 3**: a single Web frontend backed by a Rust native backend. All data stays local — no cloud, no account.

The music player is **Apple-Music-inspired** — fluid dynamic background, cover-driven color extraction, and word-by-word karaoke lyrics. The whole app strictly follows the **Material Design 3** design system.

> Reference-first principle: this implementation is modeled on `音乐播放器参考/` (an Apple Music–style lyric player). All magic numbers, easing curves and blur/saturate/brightness values are kept 1:1 from its `index.css` / `index.js`.

## ✨ Key Features

1. 🎨 **Material Design 3** — follows the M3 design philosophy with Monet dynamic theming.
2. 🗂️ **Multi-type media in one place** — images, videos, music and e-books (EPUB/PDF), with recursive scanning + a SQLite index.
3. 🎵 **Apple-Music-style player** — fluid dynamic background, cover-driven colors, karaoke-style word-by-word lyrics.
4. 🖥️ **Windows SMTC support** — taskbar media overlay, media keys (play/pause/next/prev/seek), album art.
5. 🌐 **Online music (experimental)** — search and playlists powered by the open-source meting API; download audio and cover art locally.
6. 📖 **Built-in EPUB / PDF readers** — a collapsible chapter sidebar and automatic reading-progress save/restore (CFI-exact, saved on app exit or book close). The PDF reader supports single / dual / scroll modes.
7. 🌍 **Chinese / English i18n** · 🗑️ favorites, history and trash.

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) toolchain
- Windows: MSVC Build Tools for local Tauri builds

### Local development
```bash
npm install
npm run tauri dev
```

### Frontend-only preview (browser + mock data)
```bash
npm install
npm run dev            # Vite dev server (localhost:1420)
```

### Production build
```bash
npm run build          # Type-check + build the frontend
npx tauri build        # Bundles (Windows NSIS/MSI, Linux AppImage)
```

> **CI/CD (recommended):** pushing to `main` automatically builds Windows NSIS + Linux AppImage (artifacts on Actions); pushing a `v*` tag creates a GitHub Release with installers. No local MSVC required.

## 🏗️ Tech Stack

| Area | Tech |
|---|---|
| Desktop shell | **Tauri 2** (Rust) |
| Frontend | **Vue 3 + Vite + TypeScript** |
| State | **Pinia** |
| UI | **Material Design 3** (`@material/web` + custom components) |
| Database | **rusqlite** (SQLite, WAL) |
| Audio metadata / thumbnails | **lofty**, **image**, **kamadak-exif** |
| Windows media controls | **smtc-tokio** + **tiny_http** (SMTC) |
| EPUB / PDF | **epub.js**, **pdf.js** |
| Word-timing analysis | Web Worker + FFT (spectral flux) + IndexedDB |
| Online music | meting API |
| i18n | light-weight custom i18n |

## 📁 Project Structure

```
src/               # Web frontend
  capabilities/    # Unified native bridge (invoke wrappers + browser mock)
  stores/          # Pinia stores (library / player / settings)
  components/      # FluidBackground / LyricsView / BookReader / ContextMenu …
  views/           # Per-type tabs & the full-screen player
  workers/         # Word-analysis Web Worker
  utils/           # lyric timeline / meting API / word cache & analysis / format
  tokens/          # M3 design tokens (theme.css)
src-tauri/         # Rust backend
  src/commands/    # scan / metadata / song / thumbnail / smtc / book
  capabilities/    # Tauri permission grants (least privilege)
  tauri.conf.json
shared/            # Shared types / i18n
.github/workflows/ # GitHub Actions CI
```

## 🤝 Contributing

Issues and pull requests are welcome! Please open an issue first to discuss non-trivial changes.

## 📄 License

**GPL-3.0-only** — see [LICENSE](LICENSE) for the full text.

The QQ Music QRC word-timed lyrics module is ported from [LDDC](https://github.com/chenmozhijin/LDDC) (© 沉默の金, GPL-3.0-only).
