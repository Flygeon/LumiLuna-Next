<script setup lang="ts">
defineProps<{
  title: string;
  description?: string;
}>();
</script>

<template>
  <header class="page-head">
    <div class="page-head-text">
      <h2>{{ title }}</h2>
      <p v-if="description" class="page-head-desc">{{ description }}</p>
    </div>
    <div class="page-head-trailing">
      <slot />
    </div>
  </header>
</template>

<style scoped>
.page-head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 20px;
}
.page-head-text {
  min-width: 0;
}
.page-head h2 {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  line-height: 1.2;
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-head-desc {
  margin: 2px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.page-head-trailing {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: none;
  white-space: nowrap;
}
</style>