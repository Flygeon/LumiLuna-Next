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

onMounted(async () => {
  try {
    src.value = await pixiv.imageUrl(pixiv.coverUrl(props.illust));
  } catch {
    src.value = "";
  }
});
</script>

<template>
  <button class="pixiv-card" @click="$emit('open')">
    <div class="cover">
      <img v-if="src" :src="src" :alt="illust.title" loading="lazy" />
      <span v-else class="material-symbols-outlined">image</span>
    </div>
    <div class="meta">
      <div class="title" :title="illust.title">{{ illust.title }}</div>
      <div class="sub">
        <span class="bm" :title="bmLabel">
          <span class="material-symbols-outlined">bookmark</span>{{ illust.totalBookmarks }}
        </span>
        <span class="author" :title="illust.user.name">{{ illust.user.name }}</span>
      </div>
    </div>
  </button>
</template>

<style scoped>
.pixiv-card {
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
.pixiv-card:focus-visible {
  outline: 2px solid var(--md-sys-color-primary);
  outline-offset: 4px;
  border-radius: var(--md-sys-shape-corner-large);
}
.cover {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  aspect-ratio: 1 / 1;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-outline);
  transition:
    transform 220ms var(--md-sys-motion-spring-soft),
    box-shadow 220ms var(--md-sys-motion-easing-standard);
}
.pixiv-card:hover .cover {
  transform: translateY(-4px) scale(1.015);
  box-shadow: var(--md-elevation-3), inset 0 0 0 1px var(--lm-hairline);
}
.pixiv-card:active .cover {
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
