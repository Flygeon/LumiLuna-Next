<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const router = useRouter();

function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="treasure-view">
    <h2 class="page-title">{{ t("settings.treasure.title") }}</h2>
    <p class="page-hint">{{ t("settings.treasure.subtitle") }}</p>

    <div class="card-grid">
      <button class="t-card" @click="router.push('/folders')">
        <span class="t-icon material-symbols-outlined">folder</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.folders") }}</div>
          <div class="t-desc">{{ t("settings.treasure.foldersHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/webdav')">
        <span class="t-icon material-symbols-outlined">cloud</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.webdav") }}</div>
          <div class="t-desc">{{ t("settings.treasure.webdavHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/treasure/market')">
        <span class="t-icon material-symbols-outlined">music_note</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.market") }}</div>
          <div class="t-desc">{{ t("settings.treasure.marketHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/stats')">
        <span class="t-icon material-symbols-outlined">bar_chart</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.stats") }}</div>
          <div class="t-desc">{{ t("settings.treasure.statsHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/novel-stats')">
        <span class="t-icon material-symbols-outlined">menu_book</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.novelStats") }}</div>
          <div class="t-desc">{{ t("settings.treasure.novelStatsHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.treasure-view {
  max-width: 600px;
  margin: 0 auto;
}
.page-title {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  margin: 0 0 4px;
}
.page-hint {
  margin: 0 0 20px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.card-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.t-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  border: none;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 200ms var(--md-sys-motion-spring-soft),
    box-shadow 200ms var(--md-sys-motion-easing-standard);
}
.t-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--md-elevation-2), inset 0 0 0 1px var(--lm-hairline);
}
.t-card:active {
  transform: scale(0.98);
}
.t-icon {
  font-size: 36px;
  color: var(--md-sys-color-primary);
  flex: none;
}
.t-body {
  flex: 1;
  min-width: 0;
}
.t-name {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.t-desc {
  margin-top: 4px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.t-arrow {
  font-size: 22px;
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.5;
}
</style>