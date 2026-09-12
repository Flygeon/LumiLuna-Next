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
.anime-card {
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
  outline: none;
}
.anime-card:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 4px;
  border-radius: var(--lm-shape-card);
}
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 3 / 4;
  border-radius: var(--lm-shape-card);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-outline);
  transition:
    transform 220ms var(--md-sys-motion-spring-soft),
    box-shadow 220ms var(--md-sys-motion-spring-effects-fast);
}
.anime-card:hover .cover {
  transform: translateY(-4px) scale(1.015);
  box-shadow:
    var(--md-elevation-3),
    inset 0 0 0 1px var(--lm-hairline);
}
.anime-card:active .cover {
  transform: translateY(-1px) scale(0.995);
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
