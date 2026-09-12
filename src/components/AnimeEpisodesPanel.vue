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
      <m3e-button variant="text" @click="emit('back')">
        <span slot="icon" class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </m3e-button>
      <div class="head-right">
        <span class="src-name" :title="anime.selectedSourceName">
          {{ anime.selectedSourceName }}
        </span>
        <m3e-button variant="outlined" size="small" @click="emit('changeSource')">
          <span slot="icon" class="material-symbols-outlined">swap_horiz</span>
          {{ t("anime.changeSource") }}
        </m3e-button>
      </div>
    </div>

    <h2 class="title">{{ anime.displayTitle }}</h2>

    <div v-if="anime.episodesLoading" class="state">{{ t("anime.loadingEpisodes") }}</div>
    <div v-else-if="anime.episodesError && !anime.selectedRoads.length" class="state error">
      {{ anime.episodesError }}
      <div>
        <m3e-button variant="tonal" @click="emit('changeSource')">
          <span slot="icon" class="material-symbols-outlined">swap_horiz</span>
          {{ t("anime.changeSource") }}
        </m3e-button>
      </div>
    </div>

    <template v-else>
      <div v-if="!anime.selectedRoads.length" class="state">{{ t("anime.noEpisodes") }}</div>
      <template v-else>
        <m3e-chip-set class="roads">
          <m3e-filter-chip
            v-for="(r, ri) in anime.selectedRoads"
            :key="ri"
            :selected="roadIndex === ri"
            @click="roadIndex = ri"
          >
            {{ r.name }}
          </m3e-filter-chip>
        </m3e-chip-set>
        <div class="ep-grid">
          <m3e-button
            v-for="(ep, ei) in anime.selectedRoads[roadIndex].episodes"
            :key="ei"
            class="ep"
            variant="tonal"
            size="small"
            @click="emit('play', roadIndex, ei)"
          >
            <span slot="icon" class="material-symbols-outlined">play_arrow</span>
            <span class="ep-name">{{ ep.name }}</span>
          </m3e-button>
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
.roads {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.ep-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(110px, 1fr));
  gap: 8px;
}
.ep {
  justify-content: flex-start;
}
.ep-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
