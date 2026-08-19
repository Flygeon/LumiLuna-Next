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
  <button class="novel-card" @click="$emit('open')">
    <div class="cover">
      <img v-if="cover" :src="cover" :alt="item.title" loading="lazy" />
      <span v-else class="material-symbols-outlined">menu_book</span>
    </div>
    <div class="meta">
      <div class="title" :title="item.title">{{ item.title }}</div>
      <div v-if="subtitle" class="sub" :title="subtitle">{{ subtitle }}</div>
      <div v-else-if="'author' in item && item.author" class="sub" :title="item.author">{{ item.author }}</div>
    </div>
  </button>
</template>

<style scoped>
.novel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
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