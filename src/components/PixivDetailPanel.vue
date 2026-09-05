// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { usePixivStore } from "@/stores/pixiv";
import { translate } from "@shared/i18n";
import type { PixivIllust } from "@shared/types";
import PixivCard from "@/components/PixivCard.vue";

const props = defineProps<{
  illust: PixivIllust;
  related: PixivIllust[];
  loading?: boolean;
  error?: string;
}>();
const emit = defineEmits<{ (e: "back"): void; (e: "open-related", id: number): void }>();

const settings = useSettingsStore();
const pixiv = usePixivStore();
const src = ref("");

const t = (key: string) => translate(settings.lang, key);

const detailUrl = computed(
  () =>
    props.illust.imageUrls.large ??
    props.illust.imageUrls.original ??
    pixiv.coverUrl(props.illust),
);

const tagList = computed(() => props.illust.tags.map((tg) => tg.translatedName || tg.name));
const dateText = computed(() => (props.illust.createDate || "").replace("T", " ").slice(0, 16));

onMounted(async () => {
  try {
    src.value = await pixiv.imageUrl(detailUrl.value);
  } catch {
    src.value = "";
  }
});

function openRelated(ill: PixivIllust) {
  emit("open-related", ill.id);
}
</script>

<template>
  <div class="pixiv-detail">
    <div class="search-head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("pixiv.back") }}
      </button>
      <h2 class="page-title">{{ illust.title }}</h2>
    </div>

    <div v-if="loading" class="state">{{ t("pixiv.loading") }}</div>
    <div v-else-if="error" class="state list-error">{{ error }}</div>

    <div v-else class="detail-body">
      <div class="cover-wrap">
        <img v-if="src" :src="src" :alt="illust.title" />
        <span v-else class="material-symbols-outlined placeholder">image</span>
        <span v-if="illust.pageCount > 1" class="page-badge">
          {{ illust.pageCount }} {{ t("pixiv.pages") }}
        </span>
      </div>

      <div class="info">
        <div class="author-row">
          <span class="material-symbols-outlined">person</span>
          <span>{{ illust.user.name }}</span>
        </div>

        <div class="stats">
          <span class="chip-static">
            <span class="material-symbols-outlined">visibility</span>
            {{ illust.totalView }} {{ t("pixiv.totalViews") }}
          </span>
          <span class="chip-static">
            <span class="material-symbols-outlined">bookmark</span>
            {{ illust.totalBookmarks }} {{ t("pixiv.totalBookmarks") }}
          </span>
          <span v-if="dateText" class="chip-static">
            <span class="material-symbols-outlined">event</span>{{ dateText }}
          </span>
          <span v-if="illust.width" class="chip-static">
            {{ illust.width }}×{{ illust.height }}
          </span>
        </div>

        <div v-if="tagList.length" class="tags">
          <span v-for="tag in tagList" :key="tag" class="chip">{{ tag }}</span>
        </div>

        <p v-if="illust.caption" class="caption">{{ illust.caption }}</p>
      </div>
    </div>

    <section v-if="related.length" class="section">
      <h3 class="section-title">
        <span class="material-symbols-outlined">auto_awesome_motion</span>
        {{ t("pixiv.related") }}
      </h3>
      <div class="pixiv-grid">
        <PixivCard
          v-for="ill in related"
          :key="ill.id"
          :illust="ill"
          @open="openRelated(ill)"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.pixiv-detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
  animation: lm-rise 340ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.search-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  cursor: pointer;
}
.back:hover {
  background: var(--md-sys-color-surface-container);
}
.page-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-body {
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: 20px;
  align-items: start;
}
.cover-wrap {
  position: relative;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-elevation-2);
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--md-sys-color-outline);
}
.cover-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-wrap .placeholder {
  font-size: 48px;
}
.page-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: var(--md-sys-typescale-label-small-size);
}
.info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.author-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.author-row .material-symbols-outlined {
  font-size: 20px;
  color: var(--md-sys-color-primary);
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip-static {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.chip-static .material-symbols-outlined {
  font-size: 15px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tags .chip {
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.caption {
  margin: 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-line;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.section-title .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.pixiv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.list-error {
  color: var(--md-sys-color-error);
  white-space: pre-line;
  line-height: 1.6;
  max-width: 640px;
  margin-inline: auto;
}
@media (max-width: 720px) {
  .detail-body {
    grid-template-columns: 1fr;
  }
}
</style>
