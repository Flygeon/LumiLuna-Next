<script setup lang="ts">
import { useSettingsStore, type ThemeMode } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();

function t(key: string) {
  return translate(settings.lang, key);
}

function setTheme(mode: ThemeMode) {
  settings.applyTheme(mode);
}

function switchLang() {
  settings.lang = settings.lang === "zh" ? "en" : "zh";
}

async function addScanDir() {
  const dir = await capabilities.pickDirectory();
  if (dir && !settings.scanDirs.includes(dir)) {
    settings.scanDirs.push(dir);
  }
}

function removeScanDir(index: number) {
  settings.scanDirs.splice(index, 1);
}

function clearScanDirs() {
  settings.scanDirs.splice(0, settings.scanDirs.length);
}
</script>

<template>
  <div class="settings-view">
    <h2 class="page-title">{{ t("settings.title") }}</h2>

    <section class="card">
      <h3>{{ t("settings.theme") }}</h3>
      <div class="segmented">
        <button
          class="seg"
          :class="{ active: settings.theme === 'system' }"
          @click="setTheme('system')"
        >{{ t("settings.system") }}</button>
        <button
          class="seg"
          :class="{ active: settings.theme === 'light' }"
          @click="setTheme('light')"
        >{{ t("settings.light") }}</button>
        <button
          class="seg"
          :class="{ active: settings.theme === 'dark' }"
          @click="setTheme('dark')"
        >{{ t("settings.dark") }}</button>
      </div>
    </section>

    <section class="card">
      <h3>{{ t("settings.language") }}</h3>
      <button class="row-btn" @click="switchLang">
        {{ settings.lang === "zh" ? "简体中文 / English" : "English / 简体中文" }}
      </button>
    </section>

    <section class="card">
      <h3>{{ t("settings.scanDirs") }}</h3>
      <p class="hint">{{ t("settings.scanDirsHint") }}</p>
      <div v-if="settings.scanDirs.length" class="dir-list">
        <div v-for="(dir, i) in settings.scanDirs" :key="dir" class="dir-item">
          <span class="dir-path">{{ dir }}</span>
          <button class="dir-remove" @click="removeScanDir(i)"><span class="material-symbols-outlined">close</span></button>
        </div>
      </div>
      <div v-else class="global-hint">{{ t("settings.globalScanHint") }}</div>
      <div class="dir-actions">
        <button class="row-btn" @click="addScanDir">{{ t("settings.addScanDir") }}</button>
        <button v-if="settings.scanDirs.length" class="row-btn danger" @click="clearScanDirs">{{ t("settings.clearScanDirs") }}</button>
      </div>
    </section>

    <section class="card">
      <h3>{{ t("settings.lyrics") }}</h3>
      <div class="setting-row">
        <span>{{ t("settings.lyricFontSize") }}</span>
        <input type="range" min="14" max="32" v-model.number="settings.lyricFontSize" />
        <span>{{ settings.lyricFontSize }}px</span>
      </div>
      <div class="setting-row">
        <span>{{ t("settings.lyricLineHeight") }}</span>
        <input type="range" min="1.6" max="2.6" step="0.1" v-model.number="settings.lyricLineHeight" />
        <span>{{ settings.lyricLineHeight }}</span>
      </div>
    </section>

    <section class="card">
      <h3>{{ t("settings.playback") }}</h3>
      <div class="setting-row">
        <span>{{ t("settings.bgBlur") }}</span>
        <input type="checkbox" v-model="settings.bgBlur" />
      </div>
      <div class="setting-row">
        <span>{{ t("settings.lyricBlur") }}</span>
        <input type="checkbox" v-model="settings.lyricBlur" />
      </div>
    </section>

    <section class="card">
      <h3>{{ t("settings.about") }}</h3>
      <div class="setting-row">
        <span>{{ t("settings.version") }}</span>
        <span>1.0.0</span>
      </div>
      <button class="row-btn">{{ t("settings.licenses") }}</button>
      <button class="row-btn">{{ t("settings.clearCache") }}</button>
    </section>
  </div>
</template>

<style scoped>
.settings-view {
  max-width: 720px;
  margin: 0 auto;
}
.page-title {
  font-size: var(--md-sys-typescale-headline-size);
  font-weight: var(--md-sys-typescale-headline-weight);
  margin-bottom: 20px;
}
.card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 20px;
  margin-bottom: 16px;
}
.card h3 {
  margin-bottom: 14px;
  color: var(--md-sys-color-on-surface);
}
.segmented {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-extra-large);
}
.seg {
  border: none;
  background: transparent;
  padding: 8px 18px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  cursor: pointer;
  color: var(--md-sys-color-on-surface-variant);
}
.seg.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.setting-row {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 10px;
}
.setting-row input[type="range"] {
  flex: 1;
}
.row-btn {
  width: 100%;
  padding: 10px;
  margin-top: 6px;
  border: 1px solid var(--md-sys-color-outline);
  background: transparent;
  border-radius: var(--md-sys-shape-corner-small);
  cursor: pointer;
  color: var(--md-sys-color-on-surface);
}
.hint {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 12px;
}
.dir-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 10px;
}
.dir-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
}
.dir-path {
  font-size: 13px;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  margin-right: 8px;
}
.dir-remove {
  border: none;
  background: transparent;
  color: var(--md-sys-color-error);
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dir-remove .material-symbols-outlined {
  font-size: 18px;
}
.dir-remove:hover {
  background: var(--md-sys-color-error-container);
}
.global-hint {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  padding: 10px 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-small);
  margin-bottom: 10px;
}
.dir-actions {
  display: flex;
  gap: 8px;
}
.dir-actions .row-btn {
  flex: 1;
  margin-top: 0;
}
.danger {
  color: var(--md-sys-color-error);
  border-color: var(--md-sys-color-error);
}
</style>
