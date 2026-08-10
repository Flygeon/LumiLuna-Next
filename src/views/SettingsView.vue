<script setup lang="ts">
import { useSettingsStore, type ThemeMode } from "@/stores/settings";
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
</style>
