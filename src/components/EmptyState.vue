<script setup lang="ts">
/** 统一空状态：图标 + 标题 + 说明 + 可选操作按钮 */
withDefaults(
  defineProps<{
    icon?: string;
    title: string;
    description?: string;
    actionLabel?: string;
    /** 次要操作，如「前往设置」 */
    secondaryLabel?: string;
  }>(),
  { icon: "collections_bookmark", description: "", actionLabel: "", secondaryLabel: "" },
);

const emit = defineEmits<{
  (e: "action"): void;
  (e: "secondary"): void;
}>();
</script>

<template>
  <div class="empty-state">
    <span class="icon material-symbols-outlined">{{ icon }}</span>
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
  padding: 72px 24px;
  min-height: 55vh;
  animation: lm-rise 420ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.icon {
  font-size: 76px;
  color: var(--md-sys-color-outline-variant);
  font-variation-settings: 'FILL' 0, 'wght' 200, 'opsz' 48;
  margin-bottom: 20px;
}
.title {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  color: var(--md-sys-color-on-surface);
}
.description {
  margin-top: 8px;
  max-width: 380px;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}
.actions {
  display: flex;
  gap: 8px;
  margin-top: 24px;
}
</style>
