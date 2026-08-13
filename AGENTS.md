# AGENTS.md

## Project

Tauri 2 + Vue 3 + TypeScript desktop media library app. Rust backend (SQLite, lofty, image processing) with Vue frontend (Pinia, vue-router, Material Design 3).

## Commands

```bash
# Frontend only (browser preview, no native APIs)
npm install && npm run dev          # Vite dev server on :1420
npm run build                       # vue-tsc --noEmit && vite build

# Full Tauri app (requires Rust + MSVC on Windows or system deps on Linux)
npx tauri dev                       # Dev mode with hot reload
npx tauri build                     # Production build

# Type checking (frontend only, fast)
npx vue-tsc --noEmit

# Rust checks (needs MSVC on Windows - CI builds only locally)
cd src-tauri && cargo check
```

## Architecture

- `src/` — Vue frontend (lazy-loaded route components)
- `src-tauri/` — Rust backend (Tauri commands, SQLite DB in memory)
- `shared/` — Types and i18n shared between frontend and backend
- `src/capabilities/index.ts` — All Tauri IPC calls go through this single bridge. Mock mode for browser preview.
- `src/stores/` — Pinia stores: `library` (file cache + scan), `player` (audio playback + queue), `settings` (persisted via tauri-plugin-store)
- `src/tokens/theme.css` — M3 design tokens (CSS variables). Edit colors here, not in components.

## Key Conventions

- **No emojis in UI** — Use Material Symbols Rounded icons only (class: `material-symbols-outlined`)
- **Path aliases**: `@` → `src/`, `@shared` → `shared/`
- **Icons font**: Google Fonts CDN (Chinese mirror `fonts.googleapis.cn`). CSS class `.material-symbols-outlined` maps to `Material Symbols Rounded` font family.
- **Music player**: FluidBackground uses 4-quadrant rotating canvas + `screen` blend + `blur(30px) saturate(2.5) brightness(0.5) scale(1.5)`. Magic numbers from Apple Music reference — do not change.
- **Lyric parser**: `parseLrc()` in `player.ts` supports dual-language (same-timestamp lines or `[tr:]` tags). LyricLine has `text` + `translation` fields. Each line also gets a rough word-timeline (`units`) via `src/utils/lyricTimeline.ts` (tokenize + proportional timing) — `LyricsView` renders word-by-word highlight for the active line. Plan: `逐字歌词策划书.md`.
- **Audio playback**: Use `convertFileSrc()` from `@tauri-apps/api/core` to convert file paths. Audio element must be bound via `bindAudio()` then `initAudio()` called after mount.
- **Windows SMTC**: `commands/smtc.rs` registers the app as a system media session (Windows-only deps `smtc-tokio` + `tiny_http`, target-gated). Frontend pushes metadata via `capabilities.smtcSetMedia()` (local: `filePath`; online: `coverUrl`) and throttled state via `syncSmtc()` in the player store; OS media keys arrive as `smtc:command` events, dispatched in the player store. Covers are served over `http://127.0.0.1` by a tiny_http thread — Windows' `RandomAccessStreamReference` does NOT accept `file://` URIs. Commands no-op on non-Windows.
- **Online music (experimental)**: toggle in Settings; Music tab adds playlist/search tabs backed by the meting API (`src/utils/meting.ts`). `player.queue` is a unified `QueueItem` (`MediaEntry | OnlineSong`); `playOnline()`/`loadOnlineSong()` stream http(s) URLs. Local audio appears as a "本地音乐" playlist when online mode is on.
- **Thumbnails**: Cached in `library.thumbCache`. Loaded via `loadThumbnails()` with 6-concurrent worker pool.
- **Settings persistence**: `settings.ts` uses `LazyStore` from `@tauri-apps/plugin-store`. Auto-saves on any `watch()` change. Load on app start in `App.vue` `onMounted`.

## Build CI

GitHub Actions builds Windows (NSIS + MSI) and Linux (AppImage). Push to `main` triggers build; push `v*` tag creates Release with artifacts. Requires no local MSVC — builds happen on cloud runners.

## Gotchas

- Windows builds need MSVC (`link.exe`) — cannot build locally without Visual Studio Build Tools
- Rust `lofty` crate: `ItemKey::UnsynchronizedLyrics` does not exist in v0.20, only `ItemKey::Lyrics`
- `@tauri-apps/plugin-opener` exports `openPath` (not `open`)
- Router uses `createWebHashHistory` — components are destroyed/recreated on route change. `keep-alive` is used in `App.vue` to preserve state (excludes PlayerView).
- `library.refresh(type)` caches by type. Call with `force=true` to bypass cache after scan.
