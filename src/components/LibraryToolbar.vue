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
      <input
        v-model="term"
        type="text"
        :placeholder="t('actions.search')"
        spellcheck="false"
      />
      <button v-if="term" class="clear" @click="clearSearch">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="sorts">
      <button
        v-for="s in SORTS"
        :key="s.key"
        class="chip"
        :class="{ active: library.sortBy === s.key }"
        @click="pickSort(s.key)"
      >
        {{ s.label }}
        <span
          v-if="library.sortBy === s.key"
          class="material-symbols-outlined arrow"
        >{{ library.sortDesc ? "arrow_downward" : "arrow_upward" }}</span>
      </button>
    </div>

    <span class="count tabular-nums">{{ props.count }} 项</span>

    <div class="spacer"></div>

    <!-- 扫描中显示进度与取消，否则显示扫描按钮 -->
    <div v-if="library.scanning" class="scan-progress">
      <div class="bar">
        <div
          class="fill"
          :class="{ indeterminate: !library.progress?.total }"
          :style="{ width: (library.progress?.percent ?? 0) + '%' }"
        ></div>
      </div>
      <span class="scan-text">{{ library.scanLabel }}</span>
      <button class="lm-btn lm-btn--text" @click="library.cancelScan()">
        {{ t("actions.cancel") }}
      </button>
    </div>
    <button
      v-else
      class="lm-btn lm-btn--tonal"
      @click="library.startScan()"
    >
      <span class="material-symbols-outlined">refresh</span>
      {{ t("actions.rescan") }}
    </button>
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
  transition: background var(--md-sys-motion-duration-short),
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
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 32px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.chip:hover {
  background: var(--md-sys-color-surface-container-high);
}
.chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
}
.chip .arrow {
  font-size: 15px;
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
.bar {
  width: 140px;
  height: 4px;
  border-radius: 2px;
  background: var(--md-sys-color-surface-container-highest);
  overflow: hidden;
}
.fill {
  height: 100%;
  border-radius: 2px;
  background: var(--md-sys-color-primary);
  transition: width 200ms var(--md-sys-motion-easing-standard);
}
/* 枚举阶段总数未知，用来回滑动表示忙碌 */
.fill.indeterminate {
  width: 35% !important;
  animation: lm-indeterminate 1.2s ease-in-out infinite;
}
@keyframes lm-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(320%); }
}
.scan-text {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  min-width: 120px;
}

/* 移动端：搜索框独占一行（min-width 240px 会把排序 chip 挤出屏幕），
   chip 行允许折行，扫描文案不再撑最小宽。
   :global 是因为 .is-mobile 挂在 <html> 上，不在本组件 scope 内。 */
:global(html.is-mobile .toolbar .search) {
  flex: 1 1 100%;
  min-width: 0;
  height: 44px;
}
:global(html.is-mobile .toolbar .sorts) {
  flex-wrap: wrap;
}
:global(html.is-mobile .toolbar .chip) {
  height: 36px;
}
:global(html.is-mobile .toolbar .scan-text) {
  min-width: 0;
}
:global(html.is-mobile .toolbar .bar) {
  width: 90px;
}
</style>
