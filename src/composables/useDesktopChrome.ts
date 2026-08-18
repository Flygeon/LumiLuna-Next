/**
 * 桌面 chrome：窗口关闭拦截（最小化到托盘）、托盘播放器命令分发、
 * 应用内热键（窗口聚焦时生效，输入框内自动忽略）。
 *
 * 与 SMTC 系统媒体键共享同一套 player store 动作；托盘/热键只在
 * Tauri 桌面环境生效，浏览器预览全部 no-op。
 */
import { onBeforeUnmount, onMounted } from "vue";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { capabilities, isTauri } from "@/capabilities";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function useDesktopChrome() {
  const settings = useSettingsStore();
  const player = usePlayerStore();

  const unlisteners: (() => void)[] = [];

  function handlePlayerCommand(action: string) {
    if (!player.song) return;
    switch (action) {
      case "play":
        if (!player.playing) player.togglePlay();
        break;
      case "pause":
        if (player.playing) player.togglePlay();
        break;
      case "toggle":
        player.togglePlay();
        break;
      case "next":
        void player.next();
        break;
      case "prev":
        void player.previous();
        break;
      default:
        break;
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) return;
    if (!player.song) return;

    if (event.code === "Space") {
      event.preventDefault();
      player.togglePlay();
      return;
    }

    if (!event.ctrlKey) return;
    switch (event.code) {
      case "ArrowLeft":
        event.preventDefault();
        player.seek(Math.max(0, player.currentTime - 5));
        break;
      case "ArrowRight":
        event.preventDefault();
        player.seek(
          Math.min(
            Number.isFinite(player.duration) ? player.duration : Number.MAX_SAFE_INTEGER,
            player.currentTime + 5,
          ),
        );
        break;
      case "ArrowUp":
        event.preventDefault();
        player.setVolume(settings.volume + 0.05);
        break;
      case "ArrowDown":
        event.preventDefault();
        player.setVolume(settings.volume - 0.05);
        break;
      default:
        break;
    }
  }

  onMounted(async () => {
    if (!isTauri) return;

    try {
      const win = getCurrentWindow();
      const unlistenClose = await win.onCloseRequested(async (event) => {
        event.preventDefault();
        if (settings.closeToTray) {
          await win.hide().catch(() => {});
        } else {
          await capabilities.exitApp();
        }
      });
      unlisteners.push(unlistenClose);
    } catch {
      /* 非 Tauri 或权限不足 */
    }

    try {
      const unlistenCommands = await capabilities.onAppPlayerCommand(
        handlePlayerCommand,
      );
      unlisteners.push(unlistenCommands);
    } catch {
      /* 静默 */
    }

    window.addEventListener("keydown", onKeyDown);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("keydown", onKeyDown);
    unlisteners.forEach((un) => un());
    unlisteners.length = 0;
  });
}