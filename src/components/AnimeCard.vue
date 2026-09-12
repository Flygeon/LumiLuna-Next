<script setup lang="ts">
import type { AnimeItem } from "@shared/types";

defineProps<{ item: AnimeItem; subtitle?: string }>();
defineEmits<{ (e: "open", ev: MouseEvent): void }>();
</script>

<template>
  <button class="anime-card" :data-anime-id="item.src" @click="$emit('open', $event)">
    <div class="cover">
      <img
        v-if="item.cover"
        :src="item.cover"
        :alt="item.title"
        loading="lazy"
        decoding="async"
        referrerpolicy="no-referrer"
      />
      <span v-else class="material-symbols-outlined">movie</span>
    </div>
    <div class="meta">
      <div class="title" :title="item.title">{{ item.title }}</div>
      <div v-if="subtitle" class="sub" :title="subtitle">{{ subtitle }}</div>
    </div>
  </button>
</template>

<style scoped>
/* M3 Filled Card：容器分层底色 + 1 级高程，封面内缩、标题与封面留 8dp 间距 */
.anime-card {
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
.anime-card:hover {
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-elevation-2);
}
.anime-card:active {
  transform: scale(0.99);
}
.anime-card:focus-visible {
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
