<script setup lang="ts">
/**
 * 选集面板（照 Kazumi 选源后进入带线路/剧集的列表形态）：
 * 显示已选中源的播放线路（分路）× 剧集，点某集 → 播放。
 * 头部可一键「换源」回到聚合搜索。
 */
import { ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";

const emit = defineEmits<{
  (e: "back"): void;
  (e: "play", roadIndex: number, episodeIndex: number): void;
  (e: "changeSource"): void;
}>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

/** 当前选中的播放线路 */
const roadIndex = ref(0);
</script>

<template>
  <div class="anime-episodes">
    <div class="head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </button>
      <div class="head-right">
        <span class="src-name" :title="anime.selectedSourceName">
          {{ anime.selectedSourceName }}
        </span>
        <button class="chip" @click="emit('changeSource')">
          <span class="material-symbols-outlined">swap_horiz</span>
          {{ t("anime.changeSource") }}
        </button>
      </div>
    </div>

    <h2 class="title">{{ anime.displayTitle }}</h2>

    <div v-if="anime.episodesLoading" class="state">{{ t("anime.loadingEpisodes") }}</div>
    <div v-else-if="anime.episodesError && !anime.selectedRoads.length" class="state error">
      {{ anime.episodesError }}
      <button class="lm-btn lm-btn--tonal retry" @click="emit('changeSource')">
        <span class="material-symbols-outlined">swap_horiz</span>
        {{ t("anime.changeSource") }}
      </button>
    </div>

    <template v-else>
      <div v-if="!anime.selectedRoads.length" class="state">{{ t("anime.noEpisodes") }}</div>
      <template v-else>
        <div class="roads">
          <button
            v-for="(r, ri) in anime.selectedRoads"
            :key="ri"
            class="road-chip"
            :class="{ active: roadIndex === ri }"
            @click="roadIndex = ri"
          >
            {{ r.name }}
          </button>
        </div>
        <div class="ep-grid">
          <button
            v-for="(ep, ei) in anime.selectedRoads[roadIndex].episodes"
            :key="ei"
            class="ep"
            @click="emit('play', roadIndex, ei)"
          >
            <span class="material-symbols-outlined">play_arrow</span>
            <span class="ep-name">{{ ep.name }}</span>
          </button>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.anime-episodes {
  display: flex;
  flex-direction: column;
  gap: 14px;
  animation: lm-rise 320ms var(--md-sys-motion-spring-spatial) both;
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
.head-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.src-name {
  max-width: 200px;
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
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
.chip:hover {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}
.chip .material-symbols-outlined {
  font-size: 16px;
}
.title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
}
.state {
  padding: 40px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.state.error {
  color: var(--md-sys-color-error);
  white-space: pre-line;
  line-height: 1.6;
}
.retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 12px;
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
  transition: background var(--md-sys-motion-duration-short)
    var(--md-sys-motion-spring-effects-fast);
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
