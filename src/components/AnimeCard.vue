<script setup lang="ts">
import { computed } from "vue";
import type { AnimeItem } from "@shared/types";

const props = defineProps<{ item: AnimeItem; subtitle?: string }>();
defineEmits<{ (e: "open", ev: MouseEvent): void }>();

/** 无封面时的占位 SVG（纯色，确保 img 直接 slot=header 触发 has-header-media，header 无 padding 边到边） */
const PLACEHOLDER_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 3 4'%3E%3Crect width='100%25' height='100%25' fill='%232a2a2e'/%3E%3C/svg%3E";

const coverSrc = computed(() => props.item.cover || PLACEHOLDER_COVER);
</script>

<template>
  <!-- 媒体卡：img 直接 slot="header"（不被 div 包裹），m3e-card 检测到直接 IMG 子节点
       会加 has-header-media 类，header 无 padding、封面边到边铺满、自动圆角 -->
  <m3e-card
    class="anime-card"
    variant="elevated"
    actionable
    :data-anime-id="item.src"
    @click="$emit('open', $event)"
  >
    <img
      slot="header"
      class="cover-img"
      :src="coverSrc"
      :alt="item.title"
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
    />
    <div slot="content" class="meta">
      <div class="title" :title="item.title">{{ item.title }}</div>
      <div v-if="subtitle" class="sub" :title="subtitle">{{ subtitle }}</div>
    </div>
  </m3e-card>
</template>

<style scoped>
.anime-card {
  cursor: pointer;
}
/* 封面图：aspect-ratio 控制卡片头比例，width:100% 边到边；
   m3e-card ::slotted(img) 已设 object-fit:cover，无需重复 */
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
