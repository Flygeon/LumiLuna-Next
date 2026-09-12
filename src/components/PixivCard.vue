// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { usePixivStore } from "@/stores/pixiv";
import { translate } from "@shared/i18n";
import type { PixivIllust } from "@shared/types";

const props = defineProps<{ illust: PixivIllust }>();
defineEmits<{ (e: "open"): void }>();

const settings = useSettingsStore();
const pixiv = usePixivStore();
const src = ref("");

const t = (key: string) => translate(settings.lang, key);
const bmLabel = computed(() => t("pixiv.totalBookmarks"));

/** 无封面时的占位 SVG（纯色，确保 img 直接 slot=header 触发 has-header-media） */
const PLACEHOLDER_COVER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect width='100%25' height='100%25' fill='%232a2a2e'/%3E%3C/svg%3E";

const coverSrc = computed(() => src.value || PLACEHOLDER_COVER);

onMounted(async () => {
  try {
    src.value = await pixiv.imageUrl(pixiv.coverUrl(props.illust));
  } catch {
    src.value = "";
  }
});
</script>

<template>
  <!-- 媒体卡：img 直接 slot="header"，触发 has-header-media，封面边到边铺满 -->
  <m3e-card class="pixiv-card" variant="elevated" actionable @click="$emit('open')">
    <img slot="header" class="cover-img" :src="coverSrc" :alt="illust.title" loading="lazy" />
    <div class="meta">
      <div class="title" :title="illust.title">{{ illust.title }}</div>
      <div class="sub">
        <span class="bm" :title="bmLabel">
          <span class="material-symbols-outlined">bookmark</span>{{ illust.totalBookmarks }}
        </span>
        <span class="author" :title="illust.user.name">{{ illust.user.name }}</span>
      </div>
    </div>
  </m3e-card>
</template>

<style scoped>
.pixiv-card {
  cursor: pointer;
}
.cover-img {
  width: 100%;
  aspect-ratio: 1 / 1;
  display: block;
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
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.bm {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
}
.bm .material-symbols-outlined {
  font-size: 14px;
}
.author {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
