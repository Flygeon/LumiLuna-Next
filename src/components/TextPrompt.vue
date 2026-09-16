<script setup lang="ts">
/**
 * M3 文本输入对话框：标题 + 单行输入 + 取消/确认。
 * 打开时自动聚焦并全选，Enter 确认，Esc / 点击遮罩取消。
 * 容器改用 @m3e/web 的 m3e-dialog：遮罩、焦点陷阱、Esc/点遮罩关闭、进出场动画都由组件负责。
 */
import { nextTick, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { resolvePrompt, useTextPrompt } from "@/composables/useTextPrompt";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const prompt = useTextPrompt();
const value = ref("");
const inputRef = ref<HTMLInputElement | null>(null);
const dialogRef = ref<HTMLElement | null>(null);

/** m3e-dialog 的打开 / 关闭方法 */
interface M3eDialog extends HTMLElement {
  show(): Promise<void>;
  hide(returnValue?: string): Promise<void>;
}

/** 本次交互意图：ok = 确认；其余（取消 / 点遮罩 / Esc）一律按取消结算 */
let intent: "ok" | "cancel" = "cancel";
/** 防止 cancel 与 closed 重复结算（resolvePrompt 只应生效一次） */
let settled = false;

function t(key: string) {
  return translate(settings.lang, key);
}

watch(
  () => prompt.visible,
  async (v) => {
    if (!v) return;
    value.value = prompt.initial;
    intent = "cancel";
    settled = false;
    await nextTick();
    // 用 m3e-dialog.show() 驱动打开：遮罩、焦点陷阱、进出场动画由组件负责
    await (dialogRef.value as M3eDialog | null)?.show();
  },
);

/** 完成打开后再聚焦并全选，避开与打开动画 / 焦点接管的竞态 */
function onOpened() {
  const el = inputRef.value;
  if (el) {
    el.focus();
    el.select();
  }
}

/** 结算一次（resolvePrompt 会置 visible=false 并 resolve 调用方） */
function settle(v: string | null) {
  if (settled) return;
  settled = true;
  resolvePrompt(v);
}

function confirm() {
  if (!value.value.trim()) return;
  intent = "ok";
  void (dialogRef.value as M3eDialog | null)?.hide();
}

function cancel() {
  intent = "cancel";
  void (dialogRef.value as M3eDialog | null)?.hide();
}

/** 点遮罩 / 按 Esc：m3e 已开始关闭，这里同步结算，避免 open 仍为真导致重开 */
function onCancel() {
  // 程序化 hide() 也可能触发 cancel；此时 intent 已被按钮置为 ok，不能按取消结算
  if (intent === "ok") return;
  settle(null);
}

function onClosed() {
  settle(intent === "ok" ? value.value.trim() || null : null);
}
</script>

<template>
  <Teleport to="body">
    <m3e-dialog
      ref="dialogRef"
      class="text-prompt"
      @opened="onOpened"
      @cancel="onCancel"
      @closed="onClosed"
    >
      <span slot="header">{{ prompt.title }}</span>
      <input
        ref="inputRef"
        v-model="value"
        class="dlg-input"
        maxlength="64"
        @keydown.enter="confirm"
      />
      <div slot="actions" end>
        <m3e-button variant="text" size="small" @click="cancel">{{
          t("actions.cancel")
        }}</m3e-button>
        <m3e-button variant="tonal" size="small" :disabled="!value.trim()" @click="confirm">
          {{ t("actions.confirm") }}
        </m3e-button>
      </div>
    </m3e-dialog>
  </Teleport>
</template>

<style scoped>
.text-prompt {
  --m3e-dialog-min-width: 360px;
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
