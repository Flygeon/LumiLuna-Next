# LumiLuna · Media Library

<div align="center">

**All-in-one media management app** — browse, organize and play **images, videos, music and e-books (EPUB/PDF)** in one desktop app, with three built-in online sources: Pixiv, online novels and online anime.

[English](README.md) ｜ [简体中文](README_zh.md)

Current version **v1.2.1**

</div>

LumiLuna is built on **Tauri 2 + Vue 3 + TypeScript + Material Design 3**: a single Web frontend backed by a Rust native backend. All data stays local — no cloud sync, no mandatory account.

The music player is **Apple-Music-inspired** — fluid dynamic background, cover-driven color extraction, and word-by-word karaoke lyrics. The whole app strictly follows the **Material Design 3** design system.

## ✨ Key Features

### 🗂️ Local Library

- Images / videos / music / e-books (EPUB, PDF) in one place, with recursive directory scanning + a SQLite (WAL) index
- Audio tags (lofty), EXIF orientation, and cached image/video thumbnails
- Folder browsing, favorites, history and a recoverable trash
- Frameless custom Windows title bar, system tray and global hotkeys

### 🎵 Music Player

- **Apple-Music-style player**: fluid dynamic background, cover-driven colors, karaoke-style word-by-word lyrics
- **Word-timed lyrics**: official QQ Music QRC / KuGou KRC timelines, with a Web Worker + FFT (spectral flux) analyzer as a local fallback
- **Audio effects engine**: 10-band EQ + bass boost + reverb + stereo width; presets can be saved, imported/exported and shared via compact LLFX3 codes
- **Desktop lyrics**: standalone click-through always-on-top window, 4 transition animations, position memory and lock
- **SMTC (Windows system media controls)**: taskbar media overlay, media keys (play/pause/prev/next/seek), album art
- **Online music**: NetEase Cloud Music QR-code / phone-number login (full weapi / xeapi protocol), cloud drive and playlists; plus an experimental Meting aggregate source
- "Listen now" feed (private FM / daily recommendations), comments panel, listening-time statistics

### 📖 Readers

- Built-in **EPUB / PDF** readers with a chapter sidebar and single / dual / scroll page modes
- **Automatic reading-progress save & restore** (CFI-exact; saved on app exit or when a book is closed)
- Background themes (dark / light / sepia / green), body font, font size, line height and paragraph spacing
- Online novels reuse the same reader settings and pagination

### 🌐 Online Sources

- **Online images (Pixiv)** — login, recommendations / rankings / search, artwork details with multi-page viewer, comments, favorites, follow & follow feed, ugoira playback. Images are proxied through Rust with the proper `Referer`. Disabled by default; enable it in Settings
- **Online novels** — Wenku8 login with online bookshelf, BiQuGe (BQG) source, online reading and reading statistics
- **Online anime** — rule-based aggregated search with source switching, trending homepage, Bangumi details and collection sync; ArtPlayer + DanDanPlay danmaku + HLS

### 🎨 Appearance & Extensions

- **Material Design 3**: Monet dynamic theming, light / dark / follow-system
- **Skin system**: import and persist external skin packs (ZIP assets + background + icon pack + CSS injection); bundled skins included, samples in `example/`
- **Extension framework (Extension Host)**: extensions run as standalone sidecars, so the main app gains zero size. The first reference extension, **MiaoHui (妙绘)**, adds image/video indexing + OCR + ASR + vector search
- Audio-effect preset market: pull community presets online and import in one click
- 🌍 Chinese / English i18n

## 🔗 Reference Projects

Parts of this project are ported from or modeled on the following open-source projects. Thanks to their authors:

| Project | Used for | License |
|---|---|---|
| [pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) | Pixiv login, image viewing | GPL-3.0 |
| [hikari_novel_flutter](https://github.com/15dd/hikari_novel_flutter) | Novel parsing | MIT |
| [Kazumi](https://github.com/Predidit/Kazumi) | Anime parsing | GPL-3.0 |
| [LDDC](https://github.com/chenmozhijin/LDDC) | QQ Music QRC word-timed lyrics | GPL-3.0-only |

## 🚀 Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/) 1.82+
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

> **CI/CD (recommended):** pushing to `main` automatically builds Windows NSIS + Linux AppImage (artifacts on Actions); pushing a `v*` tag creates a GitHub Release with downloadable installers. No local MSVC required.

## 🏗️ Tech Stack

| Area | Tech |
|---|---|
| Desktop shell | **Tauri 2** (Rust) |
| Frontend | **Vue 3 + Vite + TypeScript** |
| State | **Pinia** |
| UI | **Material Design 3** (`@m3e/web` M3 Expressive + `@material/web` + custom components) |
| Database | **rusqlite** (SQLite, WAL) |
| Audio metadata / thumbnails | **lofty**, **image**, **kamadak-exif** |
| Windows media controls | **smtc-tokio** + **tiny_http** (SMTC) |
| Online anime playback | **ArtPlayer** + **hls.js** + DanDanPlay danmaku |
| EPUB / PDF | **epub.js**, **pdf.js** |
| HTML/XML parsing | **scraper**, **regex**, **roxmltree** |
| NetEase protocols | Pure-Rust weapi / eapi / xeapi signing (AES-CBC/ECB, RSA, X25519 + AES-GCM) |
| Word-timing analysis | Web Worker + FFT (spectral flux) + IndexedDB |
| Online music aggregation | meting API |
| i18n | light-weight custom i18n (`shared/i18n.ts`) |

## 📁 Project Structure

```
src/               # Web frontend
  capabilities/    # Unified native bridge (invoke wrappers + browser mock)
  stores/          # Pinia stores (library / player / settings / pixiv / anime / skins / audioEffects …)
  components/      # FluidBackground / LyricsView / BookReader / NovelReader / AnimePlayer / PixivCard …
  views/           # Per-type tabs, full-screen player, desktop lyrics, extension host
  workers/         # Word-analysis Web Worker
  utils/           # lyric timeline / anime rules & streaming / NetEase / skins / WebDAV / audio effects …
  tokens/          # M3 design tokens (theme.css, fonts.css)
src-tauri/         # Rust backend
  src/commands/    # scan / metadata / thumbnail / book / smtc / skin / extension / ffmpeg
  src/*.rs         # pixiv / novel / anime / netease / webdav / tray / media
  capabilities/    # Tauri permission grants (least privilege)
  tauri.conf.json
shared/            # Shared types / i18n
example/           # Sample skins
miaohui-extension/ # Reference extension: image & video indexing + OCR + ASR + vector search (MIT)
doc/               # Design and planning documents
.github/workflows/ # GitHub Actions CI
```

## 🤝 Contributing

Issues and pull requests are welcome! Please open an issue first to discuss non-trivial changes.

## 📄 License

**GPL-3.0-only** — see [LICENSE](LICENSE) for the full text.

Third-party projects this app references or ports code from:

- [pixez-flutter](https://github.com/Notsfsssf/pixez-flutter) — Pixiv login and image viewing (© Notsfsssf, GPL-3.0)
- [hikari_novel_flutter](https://github.com/15dd/hikari_novel_flutter) — novel parsing (© 15dd, MIT)
- [Kazumi](https://github.com/Predidit/Kazumi) — anime parsing (© Predidit, GPL-3.0)
- [LDDC](https://github.com/chenmozhijin/LDDC) — the QQ Music QRC word-timed lyric module is ported from this project (© 沉默の金, GPL-3.0-only)

> Each reference project's license applies to its corresponding code; LumiLuna's own code remains GPL-3.0-only.
