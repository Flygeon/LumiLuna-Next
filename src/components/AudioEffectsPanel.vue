<script setup lang="ts">
/**
 * 音效面板：EQ + 低音增强 + 混响 + 立体声宽度 + 预设管理。
 * 用于全屏播放器右侧栏与设置页，保持一致 MD3 视觉。
 */
import { ref } from "vue";
import { useAudioEffectsStore } from "@/stores/audioEffects";
import { useSettingsStore } from "@/stores/settings";
import { capabilities, isTauri } from "@/capabilities";
import { translate } from "@shared/i18n";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";

const effects = useAudioEffectsStore();
const settings = useSettingsStore();
const newPresetName = ref("");
const importCode = ref("");
const shareStatus = ref<"copied" | "failed" | "imported" | "invalid" | null>(null);

// ---- 分享弹窗 ----
const sharePopupPresetId = ref<string | null>(null);
const uploadPopupPresetId = ref<string | null>(null);
const uploadName = ref("");
const uploadDesc = ref("");
const uploadShareCode = ref("");
const uploadStatus = ref<"idle" | "saving" | "saved" | "error">("idle");
const uploadError = ref("");

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

/** 分享按钮：先弹出选择窗 */
function showSharePopup(id: string) {
  sharePopupPresetId.value = id;
  uploadPopupPresetId.value = null;
  uploadStatus.value = "idle";
  uploadError.value = "";
}

function closeSharePopup() {
  sharePopupPresetId.value = null;
  uploadPopupPresetId.value = null;
  uploadStatus.value = "idle";
  uploadError.value = "";
}

/** 复制分享码（原行为） */
async function copyShareCode(id: string) {
  const codes = effects.exportUserPreset(id);
  if (!codes || codes.length === 0) {
    shareStatus.value = "failed";
    return;
  }
  const mode = settings.shareCodePreference;
  let code: string;
  if (mode === "chinese") {
    code = codes[0];
  } else if (mode === "original") {
    code = codes[1] ?? codes[0];
  } else {
    code = `${t("player.effectsShareChineseLabel")}：${codes[0]}\n${t("player.effectsShareOriginalLabel")}：${codes[1]}`;
  }
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
    closeSharePopup();
  } catch {
    shareStatus.value = "failed";
  }
}

/** 切换到上传至预设市场弹窗 */
function openUploadPopup(id: string) {
  const preset = effects.userPresets.find((p) => p.id === id);
  if (!preset) return;
  const codes = effects.exportUserPreset(id);
  if (!codes || codes.length === 0) return;
  // 用 LLFX3 紧凑格式作为市场分享码
  uploadName.value = preset.name;
  uploadDesc.value = "";
  uploadShareCode.value = codes[1] ?? codes[0]; // LLFX3:xxx
  uploadPopupPresetId.value = id;
  uploadStatus.value = "idle";
  uploadError.value = "";
  sharePopupPresetId.value = null;
}

async function saveUploadJson() {
  if (!uploadName.value.trim() || !uploadShareCode.value.trim()) {
    uploadError.value = "名称和分享码不能为空";
    return;
  }
  uploadStatus.value = "saving";
  uploadError.value = "";

  const jsonObj = {
    name: uploadName.value.trim(),
    version: 1,
    description: uploadDesc.value.trim(),
    shareCode: uploadShareCode.value.trim(),
  };

  const jsonStr = JSON.stringify(jsonObj, null, 2);
  const safeName = uploadName.value.trim().replace(/[^a-zA-Z0-9_-]/g, "") || "preset";
  const fileName = `preset-${safeName}.json`;

  if (isTauri) {
    // Tauri 原生保存对话框
    try {
      const filePath = await save({
        defaultPath: fileName,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!filePath) {
        uploadStatus.value = "idle";
        return;
      }
      await writeTextFile(filePath, jsonStr);
      uploadStatus.value = "saved";
      // 打开浏览器到预设仓库
      await capabilities.openUrl("https://github.com/Flygeon/LumiLuna-Presets");
    } catch (e) {
      uploadError.value = String(e);
      uploadStatus.value = "error";
    }
  } else {
    // 预览/非 Tauri 环境：下载方式
    try {
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
      uploadStatus.value = "saved";
      // 打开浏览器到预设仓库
      window.open("https://github.com/Flygeon/LumiLuna-Presets", "_blank");
    } catch (e) {
      uploadError.value = String(e);
      uploadStatus.value = "error";
    }
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
              @click="showSharePopup(p.id)"
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

    <!-- 分享选择弹窗 -->
    <Teleport to="body">
      <div
        v-if="sharePopupPresetId"
        class="popup-overlay"
        @click.self="closeSharePopup"
      >
        <div class="popup-card">
          <h4 class="popup-title">{{ t("player.effectsShare") }}</h4>
          <div class="popup-actions">
            <button class="popup-opt" @click="copyShareCode(sharePopupPresetId!)">
              <span class="material-symbols-outlined">content_copy</span>
              <span class="popup-opt-label">{{ t("player.effectsShareCopy") }}</span>
            </button>
            <button class="popup-opt" @click="openUploadPopup(sharePopupPresetId!)">
              <span class="material-symbols-outlined">cloud_upload</span>
              <span class="popup-opt-label">{{ t("player.effectsShareUpload") }}</span>
            </button>
          </div>
          <button class="popup-close" @click="closeSharePopup">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
    </Teleport>

    <!-- 上传至预设市场弹窗 -->
    <Teleport to="body">
      <div
        v-if="uploadPopupPresetId"
        class="popup-overlay"
        @click.self="closeSharePopup"
      >
        <div class="popup-card upload-card">
          <h4 class="popup-title">{{ t("player.effectsShareUpload") }}</h4>
          <p class="upload-hint">{{ t("player.effectsUploadHint") }}</p>

          <label class="upload-field">
            <span>{{ t("player.effectsUploadName") }}</span>
            <input v-model="uploadName" :placeholder="t('player.effectsUploadNamePlaceholder')" />
          </label>
          <label class="upload-field">
            <span>{{ t("player.effectsUploadDesc") }}</span>
            <textarea v-model="uploadDesc" :placeholder="t('player.effectsUploadDescPlaceholder')" rows="3" />
          </label>
          <label class="upload-field">
            <span>{{ t("player.effectsUploadShareCode") }}</span>
            <input v-model="uploadShareCode" readonly class="readonly-input" />
          </label>

          <div v-if="uploadError" class="upload-error">{{ uploadError }}</div>
          <div v-if="uploadStatus === 'saved'" class="upload-success">
            <span class="material-symbols-outlined">check_circle</span>
            {{ t("player.effectsUploadSaved") }}
          </div>

          <div class="upload-actions">
            <button
              class="lm-btn lm-btn--filled"
              :disabled="uploadStatus === 'saving' || uploadStatus === 'saved'"
              @click="saveUploadJson"
            >
              <span v-if="uploadStatus === 'saving'" class="material-symbols-outlined spinning">sync</span>
              <span v-else class="material-symbols-outlined">save</span>
              {{ uploadStatus === 'saved' ? t('player.effectsUploadSaved') : t('player.effectsUploadSave') }}
            </button>
            <button class="lm-btn lm-btn--text" @click="closeSharePopup">
              {{ t('actions.cancel') }}
            </button>
          </div>

          <button class="popup-close" @click="closeSharePopup">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
    </Teleport>
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

/* ---- 分享弹窗 ---- */
.popup-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(2px);
  animation: popup-fade 180ms var(--md-sys-motion-easing-standard);
}
@keyframes popup-fade {
  from { opacity: 0; }
  to { opacity: 1; }
}
.popup-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 380px;
  max-width: 90vw;
  max-height: 80vh;
  overflow-y: auto;
  padding: 24px 28px 20px;
  border-radius: 20px;
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-elevation-3);
  animation: popup-scale 200ms var(--md-sys-motion-easing-emphasized-decelerate);
}
@keyframes popup-scale {
  from { transform: scale(0.92); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
.popup-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.popup-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.popup-opt {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  cursor: pointer;
  text-align: left;
  transition: background 120ms;
}
.popup-opt:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.popup-opt .material-symbols-outlined {
  font-size: 22px;
  color: var(--md-sys-color-primary);
}
.popup-opt-label {
  font-weight: 500;
}
.popup-close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.popup-close:hover {
  background: var(--md-sys-color-surface-container-highest);
}

/* ---- 上传弹窗 ---- */
.upload-card {
  width: 440px;
}
.upload-hint {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  line-height: 1.5;
}
.upload-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.upload-field input,
.upload-field textarea {
  padding: 8px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
  transition: border-color 120ms;
}
.upload-field input:focus,
.upload-field textarea:focus {
  border-color: var(--md-sys-color-primary);
}
.upload-field textarea {
  resize: vertical;
}
.upload-field .readonly-input {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface-variant);
}
.upload-error {
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  font-size: var(--md-sys-typescale-body-small-size);
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}
.upload-success {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  font-size: var(--md-sys-typescale-body-small-size);
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.upload-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
</style>
