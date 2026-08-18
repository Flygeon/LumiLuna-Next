<script setup lang="ts">
/**
 * 统一空状态（StateHero 式多态面板）：
 * 图标 + 标题 + 说明 + 可选操作按钮。
 *
 * `variant` 提供默认图标与错误/离线等语义：
 * - empty  收件箱图标、副色调
 * - error  错误图标、error 色调、role=alert
 * - offline 断网图标、error 色调、role=alert
 * - auth   登录图标、副色调
 * - search 搜索无结果图标、副色调
 * 传了 `icon` 时仍覆盖默认图标。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    actionLabel?: string;
    /** 次要操作，如「前往设置」 */
    secondaryLabel?: string;
    variant?: "empty" | "error" | "offline" | "auth" | "search";
  }>(),
  {
    icon: "",
    description: "",
    actionLabel: "",
    secondaryLabel: "",
    variant: "empty",
  },
);

const emit = defineEmits<{
  (e: "action"): void;
  (e: "secondary"): void;
}>();

const VARIANT_ICONS: Record<string, string> = {
  empty: "inbox",
  error: "error",
  offline: "wifi_off",
  auth: "login",
  search: "search_off",
};

const resolvedIcon = computed(() => props.icon || VARIANT_ICONS[props.variant]);
const isAlert = computed(
  () => props.variant === "error" || props.variant === "offline",
);
</script>

<template>
  <div
    class="empty-state"
    :class="variant"
    :role="isAlert ? 'alert' : 'status'"
  >
    <span
      class="icon material-symbols-outlined"
      :class="{ 'icon-alert': isAlert }"
    >{{ resolvedIcon }}</span>
    <h3 class="title">{{ title }}</h3>
    <p v-if="description" class="description">{{ description }}</p>
    <div v-if="actionLabel || secondaryLabel" class="actions">
      <button
        v-if="actionLabel"
        class="lm-btn lm-btn--filled"
        @click="emit('action')"
      >
        {{ actionLabel }}
      </button>
      <button
        v-if="secondaryLabel"
        class="lm-btn lm-btn--text"
        @click="emit('secondary')"
      >
        {{ secondaryLabel }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 28px;
  min-height: 240px;
  border-radius: 20px;
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  animation: lm-rise 420ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  font-size: 28px;
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
  margin-bottom: 16px;
}
.icon-alert {
  color: var(--md-sys-color-error);
  background: color-mix(in srgb, var(--md-sys-color-error) 10%, transparent);
}
.title {
  font-size: 17px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  margin: 0;
}
.description {
  margin: 6px 0 0;
  max-width: 380px;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 18px;
}
</style>