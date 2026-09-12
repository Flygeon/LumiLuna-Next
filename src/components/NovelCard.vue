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
      <div v-else-if="'author' in item && item.author" class="sub" :title="item.author">
        {{ item.author }}
      </div>
    </div>
  </button>
</template>

<style scoped>
/* M3 Filled Card：容器分层底色 + 1 级高程，封面内缩、文字与封面留 8dp 间距 */
.novel-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 8px 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container-low);
  color: inherit;
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  outline: none;
  box-shadow: var(--md-elevation-1);
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
    box-shadow var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard),
    transform 200ms var(--md-sys-motion-spring);
}
.novel-card:hover {
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-elevation-2);
}
.novel-card:active {
  transform: scale(0.99);
}
.novel-card:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 4px;
}
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--md-sys-shape-corner-medium);
  overflow: hidden;
  background: var(--md-sys-color-surface-container-high);
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
  margin-top: 4px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
