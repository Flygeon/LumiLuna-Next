<script setup lang="ts">
/**
 * 扩展宿主页面（专用窗口，label: extension）。
 *
 * 由 Rust 侧 open_extension_window() 创建并 emit `ext:navigate` 导航事件；
 * 本页面按事件里的 ext/route 加载扩展自带的 web UI：
 *   <iframe src="asset://.../extensions/<id>/web/dist/index.html?route=...">
 * 扩展 UI 在 iframe 内没有 Tauri 桥接，通过 postMessage 与本页面通信：
 *   iframe → 本页：{ source: "<extid>-ext" 统一 "miaohui-ext", type: "invoke",
 *                    reqId, method, payload }
 *   本页 → iframe：{ source: "lumiluna-host", type: "invoke-result",
 *                    reqId, ok, data, error }
 * invoke 统一走 ext_invoke（open/reveal 由主机拦截代执行，见 extension.rs）。
 */
import { onBeforeUnmount, onMounted, ref } from "vue";
import { appDataDir, join } from "@tauri-apps/api/path";
import { convertFileSrc } from "@tauri-apps/api/core";
import { capabilities, isTauri } from "@/capabilities";

const current = ref<{ ext: string; route: string } | null>(null);
const iframeSrc = ref("");
const loadError = ref("");
const statusText = ref("");

let unNav: (() => void) | null = null;

async function navigateTo(ext: string, route: string) {
  current.value = { ext, route };
  loadError.value = "";
  if (!isTauri) {
    loadError.value = "非 Tauri 环境，无法加载扩展 UI";
    return;
  }
  try {
    const base = await appDataDir();
    const htmlPath = await join(base, "extensions", ext, "web", "dist", "index.html");
    iframeSrc.value = `${convertFileSrc(htmlPath)}?ext=${encodeURIComponent(ext)}&route=${encodeURIComponent(route)}`;
  } catch (e) {
    loadError.value = `解析扩展 UI 路径失败：${String(e)}`;
    iframeSrc.value = "";
  }
}

// ---- iframe postMessage 桥接 ----
function onMessage(ev: MessageEvent) {
  const m = ev.data as
    | { source?: string; type?: string; reqId?: string; method?: string; payload?: unknown }
    | null;
  if (!m || m.source !== "miaohui-ext" || m.type !== "invoke" || !m.reqId) return;
  const ext = current.value?.ext ?? "";
  const reply = (ok: boolean, data?: unknown, error?: string) => {
    iframeRef.value?.contentWindow?.postMessage(
      { source: "lumiluna-host", type: "invoke-result", reqId: m.reqId, ok, data, error },
      "*",
    );
  };
  capabilities
    .extInvoke(ext, m.method ?? "", m.payload ?? {})
    .then((data) => reply(true, data))
    .catch((e) => {
      statusText.value = `${m.method} 失败：${String(e)}`;
      reply(false, undefined, String(e));
    });
}

const iframeRef = ref<HTMLIFrameElement | null>(null);

function closeWindow() {
  window.close();
}

onMounted(async () => {
  window.addEventListener("message", onMessage);
  if (!isTauri) return;
  unNav = await capabilities.onExtNavigate(({ ext, route }) => {
    void navigateTo(ext, route || "search");
  });
});

onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  unNav?.();
  unNav = null;
});
</script>

<template>
  <div class="ext-host">
    <div class="bar" data-tauri-drag-region>
      <span class="title">{{ current ? `${current.ext} · ${current.route}` : "扩展" }}</span>
      <button class="close" title="关闭" @click="closeWindow">✕</button>
    </div>
    <div v-if="loadError" class="err">{{ loadError }}</div>
    <iframe
      v-else-if="iframeSrc"
      ref="iframeRef"
      class="ext-frame"
      :src="iframeSrc"
      allow="clipboard-read; clipboard-write"
    ></iframe>
    <div v-else class="err">等待导航事件（Ctrl+Alt+Space 呼出）…</div>
  </div>
</template>

<style scoped>
.ext-host {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #1b1d22;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  overflow: hidden;
}
.bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 34px;
  padding: 0 10px;
  background: rgba(255, 255, 255, 0.04);
  user-select: none;
  flex-shrink: 0;
}
.title {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.65);
}
.close {
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.55);
  cursor: pointer;
  font-size: 13px;
  padding: 2px 6px;
  border-radius: 6px;
}
.close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #fff;
}
.ext-frame {
  flex: 1;
  border: none;
  width: 100%;
  background: #1b1d22;
}
.err {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.45);
  font-size: 13px;
}
</style>
