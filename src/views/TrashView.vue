<script setup lang="ts">
import { ref } from "vue";
import MediaGrid from "@/components/MediaGrid.vue";
import EmptyState from "@/components/EmptyState.vue";
import { useEntryList } from "@/composables/useEntryList";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const { items, loading, load, open, toggleFavorite } = useEntryList(() =>
  capabilities.listTrash(),
);
const confirming = ref(false);

function t(key: string) {
  return translate(settings.lang, key);
}

async function emptyTrash() {
  await capabilities.emptyTrash();
  confirming.value = false;
  await load();
}
</script>

<template>
  <div class="view">
    <header class="page-head">
      <h2>{{ t("nav.trash") }}</h2>
      <span class="count tabular-nums">{{ items.length }} 项</span>
      <div class="spacer"></div>
      <button
        v-if="items.length && !confirming"
        class="lm-btn lm-btn--outlined"
        @click="confirming = true"
      >
        {{ t("actions.empty") }}
      </button>
      <template v-if="confirming">
        <span class="confirm-text">清除这些索引记录？磁盘文件不受影响。</span>
        <button class="lm-btn lm-btn--text" @click="confirming = false">
          {{ t("actions.cancel") }}
        </button>
        <button class="lm-btn lm-btn--filled danger" @click="emptyTrash">
          {{ t("actions.confirm") }}
        </button>
      </template>
    </header>

    <p v-if="items.length" class="hint">
      这些文件已从磁盘上移走或被重命名，索引记录仍保留。重新扫描后若文件回归会自动恢复。
    </p>

    <MediaGrid
      v-if="loading || items.length"
      :items="items"
      :loading="loading"
      aspect="1"
      :min-width="180"
      subtitle="size"
      @open="open"
      @favorite="toggleFavorite"
    />

    <EmptyState
      v-else
      icon="delete"
      title="回收站是空的"
      description="扫描时发现已不存在的文件会列在这里，供你确认后清除索引。"
    />
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
}
.page-head {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.page-head h2 {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
}
.count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.spacer {
  flex: 1;
}
.confirm-text {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.danger {
  background: var(--md-sys-color-error);
  color: var(--md-sys-color-on-error);
}
.hint {
  margin-bottom: 20px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
