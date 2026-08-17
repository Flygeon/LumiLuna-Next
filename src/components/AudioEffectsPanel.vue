<script setup lang="ts">
/**
 * 音效面板：EQ + 低音增强 + 混响 + 立体声宽度 + 预设管理。
 * 用于全屏播放器右侧栏与设置页，保持一致 MD3 视觉。
 */
import { ref } from "vue";
import { useAudioEffectsStore } from "@/stores/audioEffects";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const effects = useAudioEffectsStore();
const settings = useSettingsStore();
const newPresetName = ref("");
const importCode = ref("");
const shareStatus = ref<"copied" | "failed" | "imported" | "invalid" | null>(null);

function t(key: string) {
  return translate(settings.lang, key);
}

function isActive(id: string) {
  return effects.config.presetId === id;
}

function applyPreset(id: string) {
  effects.applyPreset(id);
}

function savePreset() {
  const name = newPresetName.value.trim();
  if (!name) return;
  effects.saveUserPreset(name);
  newPresetName.value = "";
}

function deletePreset(id: string) {
  effects.deleteUserPreset(id);
}

async function sharePreset(id: string) {
  const codes = effects.exportUserPreset(id);
  if (!codes || codes.length === 0) {
    shareStatus.value = "failed";
    return;
  }
  const code = codes.join("\n");
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(code);
    } else {
      const input = document.createElement("textarea");
      input.value = code;
      input.style.position = "fixed";
      input.style.opacity = "0";
      document.body.append(input);
      input.select();
      const copied = document.execCommand("copy");
      input.remove();
      if (!copied) throw new Error("Clipboard unavailable");
    }
    shareStatus.value = "copied";
  } catch {
    shareStatus.value = "failed";
  }
}

function importPreset() {
  shareStatus.value = effects.importUserPreset(importCode.value) ? "imported" : "invalid";
  if (shareStatus.value === "imported") importCode.value = "";
}

const frequencyLabel = (hz: number) =>
  hz >= 1000 ? `${(hz / 1000).toFixed(0)}k` : String(hz);
</script>

<template>
  <div class="audio-effects-panel">
    <label class="enable-row">
      <span class="material-symbols-outlined">graphic_eq</span>
      <span class="enable-label">{{ t("player.effectsEnable") }}</span>
      <input
        type="checkbox"
        :checked="effects.config.enabled"
        @change="effects.setEnabled(($event.target as HTMLInputElement).checked)"
      />
    </label>

    <fieldset class="effects-body" :disabled="!effects.config.enabled">
      <!-- 预设 -->
      <section class="ef-section">
        <h4 class="ef-title">{{ t("player.effectsPresets") }}</h4>
        <div class="preset-list">
          <button
            v-for="p in effects.builtinPresets"
            :key="p.id"
            class="chip"
            :class="{ active: isActive(p.id) }"
            @click="applyPreset(p.id)"
          >
            {{ p.name }}
          </button>
          <span
            v-for="p in effects.userPresets"
            :key="p.id"
            class="user-preset"
            :class="{ active: isActive(p.id) }"
          >
            <button class="chip user" @click="applyPreset(p.id)">
              {{ p.name }}
            </button>
            <button
              class="preset-action"
              :title="t('player.effectsShare')"
              @click="sharePreset(p.id)"
            >
              <span class="material-symbols-outlined">ios_share</span>
            </button>
            <button
              class="preset-action preset-delete"
              :title="t('player.effectsDelete')"
              @click="deletePreset(p.id)"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </span>
        </div>
        <div class="save-preset">
          <input
            v-model="newPresetName"
            :placeholder="t('player.effectsSaveName')"
            @keyup.enter="savePreset"
          />
          <button class="lm-btn lm-btn--tonal" @click="savePreset">
            <span class="material-symbols-outlined">save</span>
            {{ t("player.effectsSave") }}
          </button>
        </div>
        <div class="import-preset">
          <input
            v-model="importCode"
            :placeholder="t('player.effectsImportCode')"
            @keyup.enter="importPreset"
          />
          <button class="lm-btn lm-btn--tonal" @click="importPreset">
            <span class="material-symbols-outlined">input</span>
            {{ t("player.effectsImport") }}
          </button>
        </div>
        <p v-if="shareStatus" class="share-status" :class="shareStatus">
          {{ t(`player.effectsShare${shareStatus[0].toUpperCase()}${shareStatus.slice(1)}`) }}
        </p>
      </section>

      <!-- 均衡器 -->
      <section class="ef-section">
        <h4 class="ef-title">{{ t("player.effectsEq") }}</h4>
        <div class="eq-grid">
          <label
            v-for="(band, i) in effects.config.eqBands"
            :key="band.frequency"
            class="eq-band"
          >
            <span class="eq-freq">{{ frequencyLabel(band.frequency) }}</span>
            <input
              type="range"
              min="-12"
              max="12"
              step="1"
              :value="band.gain"
              @input="effects.setEqBand(i, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="eq-value tabular-nums">{{ band.gain > 0 ? `+${band.gain}` : band.gain }}</span>
          </label>
        </div>
      </section>

      <!-- 环境音效 -->
      <section class="ef-section">
        <h4 class="ef-title">{{ t("player.effectsEnvironment") }}</h4>
        <label class="slider-row">
          <span class="slider-label">
            <span class="material-symbols-outlined">sensors</span>
            {{ t("player.effectsBass") }}
          </span>
          <input
            type="range"
            min="-12"
            max="12"
            step="1"
            :value="effects.config.bassBoost"
            @input="effects.setBassBoost(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="slider-value tabular-nums">{{ effects.config.bassBoost }}</span>
        </label>
        <label class="slider-row">
          <span class="slider-label">
            <span class="material-symbols-outlined">surround_sound</span>
            {{ t("player.effectsReverb") }}
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="effects.config.reverb"
            @input="effects.setReverb(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="slider-value tabular-nums">{{ effects.config.reverb }}</span>
        </label>
        <label class="slider-row">
          <span class="slider-label">
            <span class="material-symbols-outlined">swap_horiz</span>
            {{ t("player.effectsStereo") }}
          </span>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            :value="effects.config.stereoWidth"
            @input="effects.setStereoWidth(Number(($event.target as HTMLInputElement).value))"
          />
          <span class="slider-value tabular-nums">{{ effects.config.stereoWidth }}</span>
        </label>
      </section>

      <button class="lm-btn lm-btn--text reset" @click="effects.resetToFlat()">
        <span class="material-symbols-outlined">restart_alt</span>
        {{ t("player.effectsReset") }}
      </button>
    </fieldset>
  </div>
</template>

<style scoped>
.audio-effects-panel {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  overflow-y: auto;
  padding: 2px 4px 12px 0;
  color: var(--md-sys-color-on-surface);
}

.enable-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  cursor: pointer;
  user-select: none;
}
.enable-row .material-symbols-outlined {
  color: var(--md-sys-color-primary);
  font-size: 22px;
}
.enable-label {
  flex: 1;
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
}
.enable-row input[type="checkbox"] {
  width: 20px;
  height: 20px;
  accent-color: var(--md-sys-color-primary);
  cursor: pointer;
}

.effects-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-width: 0;
  border: none;
  margin: 0;
  padding: 0;
}
.effects-body:disabled {
  opacity: 0.5;
}

.ef-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ef-title {
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  letter-spacing: 0.4px;
  text-transform: uppercase;
}

.preset-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.chip {
  height: 30px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.chip:hover {
  background: var(--md-sys-color-surface-container-high);
}
.chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
  font-weight: 600;
}
.user-preset {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.preset-action {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  opacity: 0.65;
  transition: background var(--md-sys-motion-duration-short), color var(--md-sys-motion-duration-short);
}
.preset-action:hover {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  opacity: 1;
}
.preset-delete:hover {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
  opacity: 1;
}
.preset-action .material-symbols-outlined {
  font-size: 14px;
}

.save-preset {
  display: flex;
  gap: 8px;
  margin-top: 2px;
}
.import-preset {
  display: flex;
  gap: 8px;
}
.import-preset input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  outline: none;
}
.import-preset input:focus {
  border-color: var(--md-sys-color-primary);
}
.import-preset .lm-btn {
  height: 36px;
  padding: 0 14px;
}
.import-preset .lm-btn .material-symbols-outlined {
  font-size: 17px;
}
.share-status {
  margin: -2px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.share-status.invalid,
.share-status.failed {
  color: var(--md-sys-color-error);
}
.save-preset input {
  flex: 1;
  min-width: 0;
  padding: 8px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  outline: none;
}
.save-preset input:focus {
  border-color: var(--md-sys-color-primary);
}
.save-preset .lm-btn {
  height: 36px;
  padding: 0 14px;
}
.save-preset .lm-btn .material-symbols-outlined {
  font-size: 17px;
}

.eq-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(66px, 1fr));
  gap: 8px;
}
.eq-band {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px 4px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container-low);
}
.eq-freq {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}
.eq-band input[type="range"] {
  width: 100%;
  accent-color: var(--md-sys-color-primary);
  writing-mode: vertical-lr;
  direction: rtl;
  height: 90px;
}
.eq-value {
  font-size: 11px;
  color: var(--md-sys-color-on-surface-variant);
}

.slider-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 2px;
}
.slider-label {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 150px;
  flex: none;
  font-size: var(--md-sys-typescale-body-small-size);
}
.slider-label .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.slider-row input[type="range"] {
  flex: 1;
  accent-color: var(--md-sys-color-primary);
}
.slider-value {
  width: 36px;
  text-align: right;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
}

.reset {
  align-self: flex-start;
}
</style>
