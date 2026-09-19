/**
 * 皮肤运行时桥：settings.resolveTheme 与 skins store 的共享响应式状态。
 * 独立成小模块是为了避免两个 Pinia store 互相 import 造成的循环依赖。
 */
import { computed, ref } from "vue";
import type { SkinDocument, SkinMode } from "./skinSchema";
import type { PreparedSkin } from "./skinLoader";

/** 当前激活皮肤的完整文档；null = 默认皮肤（动态配色） */
export const activeSkinDoc = ref<SkinDocument | null>(null);

/** 激活皮肤的预处理产物（css 重写 / 背景解析 / 图标清单） */
export const activePrepared = ref<PreparedSkin | null>(null);

/** 逃生通道：--safe-mode 启动时为真，本会话不加载任何皮肤（v1 方案书 §6.5） */
export const skinSafeMode = ref(false);

/** 单模式皮肤的强制模式锁（dark-only 皮肤 → "dark"）；null = 不锁定。
 *  安全模式下皮肤整体不生效，锁也随之解除。 */
export const skinModeLock = computed<SkinMode | null>(() => {
  if (skinSafeMode.value) return null;
  const modes = activeSkinDoc.value?.manifest.modes;
  if (!modes || modes.length !== 1) return null;
  return modes[0];
});

/** 背景图层显隐（App.vue 渲染 .lm-skin-bg 的开关） */
export const skinBgActive = computed(
  () =>
    !skinSafeMode.value && !!(activeSkinDoc.value?.background && activePrepared.value?.background),
);
