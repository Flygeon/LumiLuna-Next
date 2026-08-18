<script setup lang="ts">
/**
 * 音效预设市场。
 *
 * 从 GitHub 仓库拉取预设列表，展示预设卡片，点击「导入」下载并解析 shareCode 导入本地。
 */
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { useAudioEffectsStore } from "@/stores/audioEffects";
import { translate } from "@shared/i18n";
import { isTauri } from "@/capabilities";

const settings = useSettingsStore();
const effects = useAudioEffectsStore();
const router = useRouter();

/** 预设仓库 Raw 基础 URL（GitHub 仓库地址） */
const PRESET_REPO_RAW = "https://raw.githubusercontent.com/Flygeon/LumiLuna-Presets/main";

interface PresetItem {
  name: string;
  description: string;
  file: string;
}

interface PresetDetail {
  name: string;
  version: number;
  description: string;
  shareCode: string;
}

const presets = ref<PresetItem[]>([]);
const loading = ref(false);
const error = ref("");
const importing = ref<string | null>(null);

function t(key: string) {
  return translate(settings.lang, key);
}

async function loadPresets() {
  loading.value = true;
  error.value = "";
  try {
    const url = `${PRESET_REPO_RAW}/presets/index.json`;
    // 非 Tauri 环境用 fetch；Tauri 环境用 http 插件或 fetch
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const list: PresetItem[] = await res.json();
    presets.value = list;
  } catch (e) {
    error.value = String(e instanceof Error ? e.message : e);
  } finally {
    loading.value = false;
  }
}

async function importPreset(item: PresetItem) {
  importing.value = item.file;
  try {
    const url = `${PRESET_REPO_RAW}/presets/${item.file}`;
    const res = await fetch(url, { cache: "no-cache" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const detail: PresetDetail = await res.json();
    if (!detail.shareCode) throw new Error("无效的预设：缺少 shareCode");
    const imported = effects.importUserPreset(detail.shareCode);
    if (!imported) throw new Error("导入失败，分享码无效");
    // 成功提示通过 toast 或简单通知
    alert(`预设「${detail.name}」已导入并应用`);
  } catch (e) {
    alert(`导入失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    importing.value = null;
  }
}

// 默认加载
loadPresets();
</script>

<template>
  <div class="preset-market">
    <div class="market-head">
      <button class="lm-icon-btn" @click="router.back()">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <h2 class="page-title">{{ t("settings.market.title") }}</h2>
      <button class="lm-btn lm-btn--tonal" @click="loadPresets" :disabled="loading">
        <span class="material-symbols-outlined">refresh</span>
        {{ t("settings.market.refresh") }}
      </button>
    </div>

    <div v-if="loading" class="loading">{{ t("online.loading") }}</div>

    <div v-else-if="error" class="error-bar">
      <span class="material-symbols-outlined">error</span>
      {{ error }}
      <button class="lm-btn lm-btn--text" @click="loadPresets">{{ t("settings.market.refresh") }}</button>
    </div>

    <div v-else-if="!presets.length" class="empty">
      <span class="material-symbols-outlined">inventory_2</span>
      <p>{{ t("settings.market.empty") }}</p>
    </div>

    <div v-else class="preset-grid">
      <div v-for="item in presets" :key="item.file" class="preset-card">
        <div class="p-icon">
          <span class="material-symbols-outlined">graphic_eq</span>
        </div>
        <div class="p-body">
          <div class="p-name">{{ item.name }}</div>
          <div class="p-desc">{{ item.description }}</div>
        </div>
        <button
          class="lm-btn lm-btn--tonal p-import"
          :disabled="importing === item.file"
          @click="importPreset(item)"
        >
          <span class="material-symbols-outlined">download</span>
          {{ t("settings.market.import") }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.preset-market {
  max-width: 760px;
  margin: 0 auto;
}
.market-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
}
.market-head .page-title {
  flex: 1;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  margin: 0;
}
.loading {
  padding: 40px 0;
  text-align: center;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-small-size);
}
.error-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
  font-size: var(--md-sys-typescale-body-small-size);
}
.empty {
  text-align: center;
  padding: 60px 0;
  color: var(--md-sys-color-on-surface-variant);
}
.empty .material-symbols-outlined {
  font-size: 48px;
  opacity: 0.4;
}
.preset-grid {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.preset-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  transition: transform 200ms var(--md-sys-motion-spring-soft);
}
.preset-card:hover {
  transform: translateY(-1px);
}
.p-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.p-icon .material-symbols-outlined {
  font-size: 22px;
}
.p-body {
  flex: 1;
  min-width: 0;
}
.p-name {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 600;
}
.p-desc {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.p-import {
  flex: none;
  height: 34px;
  padding: 0 14px;
}
.p-import .material-symbols-outlined {
  font-size: 17px;
}
</style>