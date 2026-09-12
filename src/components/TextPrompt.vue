/** * M3 文本输入对话框：m3e-dialog + 单行输入 + 取消/确认。 * 打开时自动聚焦并全选，Enter 确认，Esc
/ 点击遮罩取消。 */
<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
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

function onKey(e: KeyboardEvent) {
  if (!prompt.visible) return;
  if (e.key === "Escape") cancel();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
});
</script>

<template>
  <m3e-dialog :open="prompt.visible" class="text-prompt" @cancel.prevent="cancel">
    <span slot="header" class="dlg-title">{{ prompt.title }}</span>
    <m3e-form-field class="dlg-field" float-label="outside">
      <input
        ref="inputRef"
        v-model="value"
        class="dlg-input"
        maxlength="64"
        @keydown.enter="confirm"
      />
    </m3e-form-field>
    <span slot="actions">
      <m3e-button variant="text" @click="cancel">
        {{ t("actions.cancel") }}
      </m3e-button>
      <m3e-button variant="tonal" :disabled="!value.trim()" @click="confirm">
        {{ t("actions.confirm") }}
      </m3e-button>
    </span>
  </m3e-dialog>
</template>

<style scoped>
.text-prompt {
  width: min(360px, calc(100vw - 48px));
}
.dlg-title {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
  color: var(--md-sys-color-on-surface);
}
.dlg-field {
  width: 100%;
  margin-top: 18px;
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
</style>
