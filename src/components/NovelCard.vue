<script setup lang="ts">
import { computed } from "vue";
import type { NovelCover, NovelShelfItem } from "@shared/types";

const props = defineProps<{
  item: NovelCover | NovelShelfItem;
  subtitle?: string;
}>();
defineEmits<{ (e: "open"): void }>();

const cover = computed(() => {
  const item = props.item;
  if ("imageUrl" in item) return item.imageUrl;
  return item.cover;
});
</script>

<template>
  <m3e-card class="novel-card" variant="elevated" actionable @click="$emit('open')">
    <div slot="header" class="cover">
      <img v-if="cover" :src="cover" :alt="item.title" loading="lazy" />
      <span v-else class="material-symbols-outlined">menu_book</span>
    </div>
    <div class="meta">
      <div class="title" :title="item.title">{{ item.title }}</div>
      <div v-if="subtitle" class="sub" :title="subtitle">{{ subtitle }}</div>
      <div v-else-if="'author' in item && item.author" class="sub" :title="item.author">
        {{ item.author }}
      </div>
    </div>
  </m3e-card>
</template>

<style scoped>
.novel-card {
  cursor: pointer;
}
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-outline);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover .material-symbols-outlined {
  font-size: 36px;
}
.meta {
  min-width: 0;
}
.title {
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sub {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
