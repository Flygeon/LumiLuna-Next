<script setup lang="ts">
/**
 * 扩展管理面板：已安装扩展列表（启用开关 / 卸载）+ 安装（文件夹 / zip）。
 * 引擎状态（engine_ready）与模型下载进度经 ext_invoke 轮询扩展引擎。
 * 注意：文案不进 shared/i18n.ts（项目 WIP 文件，禁止改动）。
 */
import { onActivated, ref } from "vue";
import { open as dialogOpen } from "@tauri-apps/plugin-dialog";
import PageHeader from "@/components/PageHeader.vue";
import { capabilities } from "@/capabilities";
import type { ExtInfo, ExtSource } from "@shared/types";

const list = ref<ExtInfo[]>([]);
const loading = ref(false);
const busy = ref("");
const toast = ref("");
let toastTimer: number | null = null;

function notify(message: string) {
  toast.value = message;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 3000);
}

async function load() {
  loading.value = true;
  try {
    list.value = await capabilities.extList();
  } catch (e) {
    notify(`加载扩展列表失败：${String(e)}`);
  } finally {
    loading.value = false;
  }
}

async function toggle(ext: ExtInfo) {
  busy.value = ext.id;
  try {
    await capabilities.extSetEnabled(ext.id, !ext.enabled);
    ext.enabled = !ext.enabled;
    notify(ext.enabled ? `已启用 ${ext.name}` : `已禁用 ${ext.name}`);
  } catch (e) {
    notify(`切换失败：${String(e)}`);
  } finally {
    busy.value = "";
  }
}

async function uninstall(ext: ExtInfo) {
  if (!window.confirm(`卸载扩展「${ext.name}」？数据目录（索引/模型）将一并删除。`)) return;
  busy.value = ext.id;
  try {
    await capabilities.extUninstall(ext.id);
    await load();
    notify(`已卸载 ${ext.name}`);
  } catch (e) {
    notify(`卸载失败：${String(e)}`);
  } finally {
    busy.value = "";
  }
}

async function install(kind: "folder" | "zip") {
  const selected = await dialogOpen({
    directory: kind === "folder",
    multiple: false,
    filters: kind === "zip" ? [{ name: "扩展包", extensions: ["zip"] }] : undefined,
  });
  if (typeof selected !== "string") return;
  const source: ExtSource =
    kind === "folder" ? { kind: "folder", path: selected } : { kind: "zip", path: selected };
  busy.value = "__install";
  notify("安装中…");
  try {
    const info = await capabilities.extInstall(source);
    await load();
    notify(`已安装 ${info.name} v${info.version}`);
  } catch (e) {
    notify(`安装失败：${String(e)}`);
  } finally {
    busy.value = "";
  }
}

onActivated(load);
</script>

<template>
  <div class="view">
    <PageHeader title="扩展" description="为 LumiLuna 安装独立分发的功能扩展包" />
    <div class="toolbar">
      <button :disabled="busy !== ''" @click="install('zip')">安装 zip 包</button>
      <button :disabled="busy !== ''" @click="install('folder')">从文件夹安装</button>
      <button :disabled="loading" @click="load">刷新</button>
    </div>
    <p v-if="toast" class="toast">{{ toast }}</p>

    <div v-if="!list.length && !loading" class="empty">
      尚未安装任何扩展。<br />
      把扩展 zip（如 miaohui-extension-*.zip）放进来即可启用离线内容检索。
    </div>

    <div v-for="ext in list" :key="ext.id" class="ext-card">
      <div class="head">
        <div>
          <div class="name">{{ ext.name }}</div>
          <div class="sub">
            id: {{ ext.id }} · v{{ ext.version || "?" }}
            <span class="state" :class="ext.enabled ? 'on' : 'off'">
              {{ ext.enabled ? (ext.engineReady ? "运行中" : "已启用") : "已禁用" }}
            </span>
          </div>
        </div>
        <div class="ops">
          <button :disabled="busy === ext.id" @click="toggle(ext)">
            {{ ext.enabled ? "禁用" : "启用" }}
          </button>
          <button class="danger" :disabled="busy === ext.id" @click="uninstall(ext)">卸载</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.view {
  padding: 0 20px 40px;
}
.toolbar {
  display: flex;
  gap: 10px;
  margin: 12px 0;
}
.toolbar button {
  padding: 6px 14px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: transparent;
}
.toolbar button:hover:not(:disabled) {
  background: rgba(128, 128, 128, 0.1);
}
.toolbar button:disabled {
  opacity: 0.5;
  cursor: default;
}
.toast {
  color: #4a90d9;
  font-size: 13px;
  margin: 4px 0;
}
.empty {
  color: rgba(128, 128, 128, 0.8);
  text-align: center;
  padding: 60px 0;
  line-height: 2;
}
.ext-card {
  border: 1px solid var(--border, #ccc);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 12px;
}
.head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}
.name {
  font-weight: 500;
}
.sub {
  font-size: 12px;
  color: rgba(128, 128, 128, 0.9);
  margin-top: 2px;
}
.state {
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 10px;
  font-size: 11px;
}
.state.on {
  background: rgba(74, 144, 217, 0.15);
  color: #4a90d9;
}
.state.off {
  background: rgba(128, 128, 128, 0.15);
  color: rgba(128, 128, 128, 0.9);
}
.ops {
  display: flex;
  gap: 8px;
}
.ops button {
  padding: 5px 12px;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid var(--border, #ccc);
  background: transparent;
}
.ops .danger:hover {
  background: rgba(220, 80, 80, 0.12);
  border-color: rgba(220, 80, 80, 0.5);
}
</style>
