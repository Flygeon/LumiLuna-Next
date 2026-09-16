<script setup lang="ts">
/** 列表页工具栏：搜索、排序、扫描入口与进度 */
import { ref, watch } from "vue";
import { useLibraryStore, type SortKey } from "@/stores/library";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const props = defineProps<{ count: number }>();

const emit = defineEmits<{ (e: "changed"): void }>();

const library = useLibraryStore();
const settings = useSettingsStore();

function t(key: string) {
  return translate(settings.lang, key);
}

const SORTS: { key: SortKey; label: string }[] = [
  { key: "name", label: "名称" },
  { key: "mtime", label: "修改时间" },
  { key: "size", label: "大小" },
  { key: "taken_at", label: "拍摄时间" },
];

// 输入防抖，避免每敲一个字就查一次库
const term = ref(library.search);
let timer: number | null = null;
watch(term, (v) => {
  if (timer !== null) clearTimeout(timer);
  timer = window.setTimeout(() => {
    library.search = v;
    emit("changed");
  }, 260);
});

function pickSort(key: SortKey) {
  if (library.sortBy === key) {
    library.sortDesc = !library.sortDesc;
  } else {
    library.sortBy = key;
    library.sortDesc = false;
  }
  emit("changed");
}

function clearSearch() {
  term.value = "";
}
</script>

<template>
  <div class="toolbar">
    <div class="search">
      <span class="material-symbols-outlined">search</span>
      <input v-model="term" type="text" :placeholder="t('actions.search')" spellcheck="false" />
      <button v-if="term" class="clear" @click="clearSearch">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="sorts">
      <m3e-filter-chip
        v-for="s in SORTS"
        :key="s.key"
        class="chip"
        :selected="library.sortBy === s.key"
        @click="pickSort(s.key)"
      >
        {{ s.label }}
        <span
          v-if="library.sortBy === s.key"
          slot="trailing-icon"
          class="material-symbols-outlined arrow"
          >{{ library.sortDesc ? "arrow_downward" : "arrow_upward" }}</span
        >
      </m3e-filter-chip>
    </div>

    <span class="count tabular-nums">{{ props.count }} 项</span>

    <div class="spacer"></div>

    <!-- 扫描中显示进度与取消，否则显示扫描按钮 -->
    <div v-if="library.scanning" class="scan-progress">
      <!-- 枚举阶段总数未知 -> indeterminate；否则按百分比显示 -->
      <m3e-linear-progress-indicator
        class="scan-bar"
        :indeterminate="!library.progress?.total"
        :max="100"
        :value="library.progress?.percent ?? 0"
      ></m3e-linear-progress-indicator>
      <span class="scan-text">{{ library.scanLabel }}</span>
      <m3e-button variant="text" size="small" @click="library.cancelScan()">
        {{ t("actions.cancel") }}
      </m3e-button>
    </div>
    <m3e-button v-else variant="tonal" size="small" @click="library.startScan()">
      <span slot="icon" class="material-symbols-outlined">refresh</span>
      {{ t("actions.rescan") }}
    </m3e-button>
  </div>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

.search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 40px;
  padding: 0 12px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  transition:
    background var(--md-sys-motion-duration-short),
    box-shadow var(--md-sys-motion-duration-short);
  min-width: 240px;
}
.search:focus-within {
  background: var(--md-sys-color-surface-container-high);
  box-shadow: 0 0 0 2px var(--md-sys-color-primary);
}
.search .material-symbols-outlined {
  font-size: 20px;
}
.search input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  min-width: 0;
}
.clear {
  display: flex;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 2px;
  border-radius: 50%;
}
.clear:hover {
  background: var(--md-sys-color-surface-container-highest);
}

.sorts {
  display: flex;
  gap: 6px;
}
.count {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.spacer {
  flex: 1;
}

.scan-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
/* 进度条本体交给 m3e-linear-progress-indicator（默认 4px 厚、primary 前景）；
   这里只把轨道色换回原来的 surface-container-highest，并固定 140px 宽度 */
.scan-bar {
  width: 140px;
  flex: none;
  --m3e-linear-progress-indicator-thickness: 4px;
  --m3e-progress-indicator-track-color: var(--md-sys-color-surface-container-highest);
}
.scan-text {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  min-width: 120px;
}
/* chip 本体交给 m3e-filter-chip / m3e-assist-chip（选中态即 M3 规范：secondary-container 底 +
   on-secondary-container 文字 + 无描边，与改造前 .chip.active 一致）；
   下面把度量对齐改造前的 .chip（含选中时组件会占用 icon 槽展示勾选标记所需的 with-icon 内边距） */
.sorts m3e-filter-chip {
  --m3e-chip-container-height: 32px;
  --m3e-chip-padding-start: 12px;
  --m3e-chip-padding-end: 12px;
  --m3e-chip-with-icon-padding-start: 12px;
  --m3e-chip-with-icon-padding-end: 12px;
  --m3e-chip-spacing: 4px;
  --m3e-chip-icon-size: 15px;
  --m3e-chip-unselected-state-layer-hover-color: var(--md-sys-color-surface-container-high);
}
</style>
