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

/** 无封面时的占位 SVG（纯色，确保 img 直接 slot=header 触发 has-header-media） */
const PLACEHOLDER_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 4'%3E%3Crect width='100%25' height='100%25' fill='%232a2a2e'/%3E%3C/svg%3E";

const coverSrc = computed(() => cover.value || PLACEHOLDER_COVER);
</script>

<template>
  <!-- 媒体卡：img 直接 slot="header"，触发 has-header-media，封面边到边铺满 -->
  <m3e-card class="novel-card" variant="elevated" actionable @click="$emit('open')">
    <img slot="header" class="cover-img" :src="coverSrc" :alt="item.title" loading="lazy" />
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
.cover-img {
  width: 100%;
  aspect-ratio: 3 / 4;
  display: block;
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
