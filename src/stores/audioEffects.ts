/**
 * 音乐播放器音效 store。
 *
 * 负责：
 * - 当前生效的音效配置（EQ/低音/混响/立体声宽度）。
 * - 内置预设 + 用户自定义预设的持久化。
 * - 与全局 audioEl 的 Web Audio 引擎绑定/更新。
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { LazyStore } from "@tauri-apps/plugin-store";
import {
  audioEffectEngine,
  DEFAULT_EQ_BANDS,
} from "@/utils/audioEffects";
import type { AudioEffectConfig, AudioEffectPreset } from "@shared/types";

const store = new LazyStore("audio-effects.json");

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function flatConfig(presetId = "flat"): AudioEffectConfig {
  return {
    enabled: false,
    eqBands: clone(DEFAULT_EQ_BANDS),
    bassBoost: 0,
    reverb: 0,
    stereoWidth: 50,
    presetId,
  };
}

function preset(
  id: string,
  name: string,
  mutate: (c: AudioEffectConfig) => void,
): AudioEffectPreset {
  const config = flatConfig(id);
  config.enabled = true;
  mutate(config);
  return { id, name, config, builtin: true };
}

const BUILTIN_PRESETS: AudioEffectPreset[] = [
  preset("flat", "Flat", () => {}),
  preset("pop", "Pop", (c) => {
    c.eqBands[1].gain = 3;
    c.eqBands[3].gain = 2;
    c.eqBands[5].gain = 1;
    c.eqBands[7].gain = 3;
    c.eqBands[9].gain = 2;
  }),
  preset("rock", "Rock", (c) => {
    c.eqBands[1].gain = 4;
    c.eqBands[2].gain = 3;
    c.eqBands[5].gain = 2;
    c.eqBands[7].gain = 3;
    c.eqBands[9].gain = 4;
  }),
  preset("classical", "Classical", (c) => {
    c.eqBands[0].gain = 3;
    c.eqBands[4].gain = -1;
    c.eqBands[8].gain = 3;
    c.eqBands[9].gain = 4;
  }),
  preset("dance", "Dance", (c) => {
    c.eqBands[1].gain = 5;
    c.eqBands[3].gain = 3;
    c.eqBands[5].gain = 0;
    c.eqBands[7].gain = 2;
    c.eqBands[9].gain = 4;
  }),
  preset("bass_boost", "Bass Boost", (c) => {
    c.bassBoost = 8;
    c.eqBands[0].gain = 6;
    c.eqBands[1].gain = 5;
  }),
  preset("vocal", "Vocal", (c) => {
    c.eqBands[2].gain = -2;
    c.eqBands[3].gain = -1;
    c.eqBands[4].gain = 2;
    c.eqBands[5].gain = 4;
    c.eqBands[6].gain = 3;
    c.eqBands[8].gain = -1;
  }),
];

export const useAudioEffectsStore = defineStore("audio-effects", () => {
  const config = ref<AudioEffectConfig>(flatConfig());
  const userPresets = ref<AudioEffectPreset[]>([]);
  const loaded = ref(false);
  const audioEl = ref<HTMLAudioElement | null>(null);

  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingAttach = false;

  function persist() {
    if (!loaded.value) return;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void store
        .set("config", clone(config.value))
        .then(() => store.set("userPresets", clone(userPresets.value)))
        .then(() => store.save())
        .catch(() => {});
    }, 300);
  }

  /**
   * 启用音效时，如果音频已经加载且尚未以 CORS 模式加载，
   * 需要设置 crossOrigin="anonymous" 并重新加载当前曲目，
   * 否则 Web Audio 的 MediaElementSource 会因 CORS 限制输出静音。
   */
  function enableWithReload() {
    const el = audioEl.value;
    if (!el || pendingAttach) return;
    pendingAttach = true;

    const src = el.src;
    const wasPlaying = !el.paused;
    const time = el.currentTime;

    try {
      el.pause();
      el.crossOrigin = "anonymous";
      el.removeAttribute("src");
      el.src = src;
      el.load();
    } catch (e) {
      pendingAttach = false;
      console.warn("[音效] 重新加载音频失败，已自动关闭音效:", e);
      config.value.enabled = false;
      return;
    }

    const onReady = () => {
      el.removeEventListener("loadedmetadata", onReady);
      el.removeEventListener("error", onError);
      pendingAttach = false;
      try {
        if (time > 0 && Number.isFinite(el.duration)) {
          el.currentTime = Math.min(time, el.duration);
        }
      } catch {
        /* 恢复进度失败不阻塞 */
      }
      try {
        audioEffectEngine.attach(el);
        audioEffectEngine.update(config.value);
        audioEffectEngine.resume();
      } catch (e) {
        console.warn("[音效] Web Audio 初始化失败，已自动关闭音效:", e);
        config.value.enabled = false;
      }
      if (wasPlaying) void el.play().catch(() => {});
    };

    const onError = () => {
      el.removeEventListener("loadedmetadata", onReady);
      el.removeEventListener("error", onError);
      pendingAttach = false;
      console.warn("[音效] 重新加载音频失败（可能不支持 CORS），已自动关闭音效");
      config.value.enabled = false;
      persist();
    };

    el.addEventListener("loadedmetadata", onReady);
    el.addEventListener("error", onError);
  }

  function syncEngine() {
    const el = audioEl.value;
    if (!el) return;
    try {
      if (config.value.enabled) {
        if (!audioEffectEngine.attached) {
          if (el.src && el.crossOrigin !== "anonymous") {
            enableWithReload();
            return;
          }
          el.crossOrigin = "anonymous";
          audioEffectEngine.attach(el);
        }
        audioEffectEngine.update(config.value);
        audioEffectEngine.resume();
      } else {
        audioEffectEngine.update(config.value);
      }
    } catch (e) {
      console.warn("[音效] Web Audio 初始化失败，已自动关闭音效:", e);
      config.value.enabled = false;
    }
  }

  function applyConfig(next: AudioEffectConfig) {
    config.value = clone(next);
    syncEngine();
    persist();
  }

  async function init() {
    try {
      const savedConfig = await store.get<AudioEffectConfig | null>("config");
      const savedUserPresets = await store.get<AudioEffectPreset[] | null>(
        "userPresets",
      );
      if (savedConfig) {
        const merged = flatConfig(savedConfig.presetId || "flat");
        config.value = {
          ...merged,
          ...savedConfig,
          eqBands:
            savedConfig.eqBands?.length === DEFAULT_EQ_BANDS.length
              ? savedConfig.eqBands
              : clone(DEFAULT_EQ_BANDS),
        };
      }
      if (Array.isArray(savedUserPresets)) {
        userPresets.value = savedUserPresets;
      }
    } catch {
      /* 读取失败使用默认配置 */
    }
    loaded.value = true;
    syncEngine();
  }

  function registerAudioElement(el: HTMLAudioElement) {
    audioEl.value = el;
    syncEngine();
  }

  function resume() {
    audioEffectEngine.resume();
  }

  function suspend() {
    audioEffectEngine.suspend();
  }

  function setEnabled(enabled: boolean) {
    config.value.enabled = enabled;
    config.value.presetId = enabled ? config.value.presetId : "flat";
    syncEngine();
    persist();
  }

  function setEqBand(index: number, gain: number) {
    const band = config.value.eqBands[index];
    if (!band) return;
    band.gain = Math.max(-12, Math.min(12, Math.round(gain)));
    config.value.presetId = "custom";
    syncEngine();
    persist();
  }

  function setBassBoost(value: number) {
    config.value.bassBoost = Math.max(-12, Math.min(12, Math.round(value)));
    config.value.presetId = "custom";
    syncEngine();
    persist();
  }

  function setReverb(value: number) {
    config.value.reverb = Math.max(0, Math.min(100, Math.round(value)));
    config.value.presetId = "custom";
    syncEngine();
    persist();
  }

  function setStereoWidth(value: number) {
    config.value.stereoWidth = Math.max(0, Math.min(100, Math.round(value)));
    config.value.presetId = "custom";
    syncEngine();
    persist();
  }

  function applyPreset(id: string) {
    const found =
      BUILTIN_PRESETS.find((p) => p.id === id) ??
      userPresets.value.find((p) => p.id === id);
    if (!found) return;
    const next = clone(found.config);
    next.enabled = true;
    applyConfig(next);
  }

  function resetToFlat() {
    const next = flatConfig("flat");
    next.enabled = config.value.enabled;
    applyConfig(next);
  }

  function saveUserPreset(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const id = `custom-${Date.now()}`;
    const next = clone(config.value);
    next.enabled = true;
    next.presetId = id;
    userPresets.value.push({ id, name: trimmed, config: next, builtin: false });
    config.value.presetId = id;
    persist();
  }

  function deleteUserPreset(id: string) {
    userPresets.value = userPresets.value.filter((p) => p.id !== id);
    if (config.value.presetId === id) {
      config.value.presetId = "flat";
    }
    persist();
  }

  watch([config, userPresets], persist, { deep: true });

  return {
    config,
    userPresets,
    builtinPresets: BUILTIN_PRESETS,
    loaded,
    audioEl,
    init,
    registerAudioElement,
    resume,
    suspend,
    setEnabled,
    setEqBand,
    setBassBoost,
    setReverb,
    setStereoWidth,
    applyPreset,
    resetToFlat,
    saveUserPreset,
    deleteUserPreset,
  };
});