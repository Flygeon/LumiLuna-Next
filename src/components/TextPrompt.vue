/**
 * M3 文本输入对话框：标题 + 单行输入 + 取消/确认。
 * 打开时自动聚焦并全选，Enter 确认，Esc / 点击遮罩取消。
 */
<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { resolvePrompt, useTextPrompt } from "@/composables/useTextPrompt";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const prompt = useTextPrompt();
const value = ref("");
const inputRef = ref<HTMLInputElement | null>(null);

function t(key: string) {
  return translate(settings.lang, key);
}

watch(
  () => prompt.visible,
  async (v) => {
    if (!v) return;
    value.value = prompt.initial;
    await nextTick();
    const el = inputRef.value;
    if (el) {
      el.focus();
      el.select();
    }
  },
);

function confirm() {
  resolvePrompt(value.value.trim() || null);
}

function cancel() {
  resolvePrompt(null);
}

onMounted(() => {
  const onKey = (e: KeyboardEvent) => {
    if (!prompt.visible) return;
    if (e.key === "Escape") cancel();
  };
  window.addEventListener("keydown", onKey);
  // 无 onBeforeUnmount 清理：组件常驻（挂载在 App.vue）
});
</script>

<template>
  <Teleport to="body">
    <div v-if="prompt.visible" class="backdrop" @click.self="cancel">
      <div class="dlg">
        <h3 class="dlg-title">{{ prompt.title }}</h3>
        <input
          ref="inputRef"
          v-model="value"
          class="dlg-input"
          maxlength="64"
          @keydown.enter="confirm"
        />
        <div class="dlg-actions">
          <button class="lm-btn lm-btn--text" @click="cancel">
            {{ t("actions.cancel") }}
          </button>
          <button
            class="lm-btn lm-btn--tonal"
            :disabled="!value.trim()"
            @click="confirm"
          >
            {{ t("actions.confirm") }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.backdrop {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.4);
  animation: fade-in 150ms var(--md-sys-motion-easing-standard);
}
@keyframes fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.dlg {
  width: min(360px, calc(100vw - 48px));
  padding: 24px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-extra-large);
  box-shadow: var(--md-elevation-3);
  animation: dlg-rise 200ms var(--md-sys-motion-easing-emphasized-decelerate);
}
@keyframes dlg-rise {
  from {
    opacity: 0;
    transform: scale(0.94) translateY(8px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.dlg-title {
  margin: 0 0 18px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
  color: var(--md-sys-color-on-surface);
}

.dlg-input {
  width: 100%;
  padding: 10px 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
}
.dlg-input:focus {
  border-color: var(--md-sys-color-primary);
  box-shadow: 0 0 0 1px var(--md-sys-color-primary);
}

.dlg-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
</style>
