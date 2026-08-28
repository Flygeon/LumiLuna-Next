<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";
import type { AnimeItem } from "@shared/types";

const props = defineProps<{ item: AnimeItem }>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "play", roadIndex: number, episodeIndex: number): void;
}>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

/** 当前选中的播放线路 */
const roadIndex = ref(0);

onMounted(() => {
  void anime.loadDetail(props.item.src, props.item.title);
});
</script>

<template>
  <div class="anime-detail">
    <div class="head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </button>
    </div>

    <div v-if="anime.detailLoading" class="state">{{ t("anime.loadingEpisodes") }}</div>
    <p v-else-if="anime.detailError" class="state error">{{ anime.detailError }}</p>

    <template v-else-if="anime.detail">
      <div class="hero">
        <div class="cover">
          <img
            v-if="anime.detail.cover"
            :src="anime.detail.cover"
            :alt="anime.detail.title"
            referrerpolicy="no-referrer"
          />
          <span v-else class="material-symbols-outlined">movie</span>
        </div>
        <div class="info">
          <h2 class="title">{{ anime.detail.title }}</h2>
          <p v-if="anime.detail.desc" class="desc">{{ anime.detail.desc }}</p>
        </div>
      </div>

      <div class="episodes">
        <h3 class="ep-title">{{ t("anime.episodes") }}</h3>
        <div v-if="!anime.detail.roads.length" class="state">{{ t("anime.noEpisodes") }}</div>
        <template v-else>
          <div class="roads">
            <button
              v-for="(r, ri) in anime.detail.roads"
              :key="ri"
              class="road-chip"
              :class="{ active: roadIndex === ri }"
              @click="roadIndex = ri"
            >{{ r.name }}</button>
          </div>
          <div class="ep-grid">
            <button
              v-for="(ep, ei) in anime.detail.roads[roadIndex].episodes"
              :key="ei"
              class="ep"
              @click="emit('play', roadIndex, ei)"
            >
              <span class="material-symbols-outlined">play_arrow</span>
              <span class="ep-name">{{ ep.name }}</span>
            </button>
          </div>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.anime-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: lm-rise 320ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.state {
  padding: 40px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.state.error {
  color: var(--md-sys-color-error);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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
.hero {
  display: flex;
  gap: 16px;
}
.cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 160px;
  aspect-ratio: 16 / 9;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-outline);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  margin: 0 0 8px;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
}
.desc {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-wrap;
}
.episodes {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.ep-title {
  margin: 8px 0 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.roads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.road-chip {
  height: 30px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
}
.road-chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.ep {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 8px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  text-align: left;
  cursor: pointer;
  transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.ep:hover {
  background: var(--md-sys-color-surface-container-high);
}
.ep .material-symbols-outlined {
  font-size: 15px;
  color: var(--md-sys-color-primary);
  flex: none;
}
.ep-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
