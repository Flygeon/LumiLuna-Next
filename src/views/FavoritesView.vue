<script setup lang="ts">
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useEntryList } from "@/composables/useEntryList";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const { items, loading, open, toggleFavorite } = useEntryList(() =>
  capabilities.listFavorites(),
);

function t(key: string) {
  return translate(settings.lang, key);
}
</script>

<template>
  <div class="view">
    <header class="page-head">
      <h2>{{ t("nav.favorites") }}</h2>
      <span class="count tabular-nums">{{ items.length }} 项</span>
    </header>

    <MediaGrid
      v-if="loading || items.length"
      :items="items"
      :loading="loading"
      aspect="1"
      :min-width="180"
      subtitle="artist"
      @open="open"
      @favorite="toggleFavorite"
    />

    <EmptyState
      v-else
      icon="favorite"
      title="还没有收藏"
      description="在任意媒体卡片上点击心形图标，即可将其加入收藏。"
    />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
.page-head {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 20px;
}
.page-head h2 {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
}
.count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
