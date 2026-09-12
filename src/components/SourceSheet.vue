<script setup lang="ts">
/**
 * 聚合搜索播放源底部面板（照 Kazumi SourceSheet 复刻）：
 * 以番剧中文名（无则原语名）并行查询全部已启用规则源，每个源一张卡：
 * 头（源名 + 状态：检索中/无结果/N 条/检索失败）+ 命中条目行（点击 → 选该源）。
 * 卡片头部更多操作：别名检索 / 手动检索 / 在浏览器中打开。
 */
import { computed, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";
import { capabilities } from "@/capabilities";
import { normalizeRule, renderTemplate } from "@/utils/animeRules";
import type { AnimeSearchItem, BangumiSubject } from "@shared/types";

const props = defineProps<{
  /** 聚合搜索的关键字（中文名优先） */
  keyword: string;
  /** 当前条目（别名列表用来做「别名检索」） */
  subject: BangumiSubject | null;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "pick", pluginName: string, item: AnimeSearchItem): void;
}>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

/** 展开的源：有结果的默认展开，点卡片头切换 */
const expanded = ref<Set<string>>(new Set());
/** 展开「更多操作」行的源 */
const moreOpen = ref<Set<string>>(new Set());
/** 「手动检索」输入框的关键字 */
const manualKeyword = ref<Record<string, string>>({});
/**
 * 顶部关键字输入框（改它 → 重查全部源）。
 *
 * 存在的理由：关键字可能压根没定下来（例如从观看历史续播时 Bangumi 详情
 * 还没拉到），此时聚合搜索会被拦下、卡片区一片空白。没有这个输入框用户
 * 就只能在每张卡里逐个手动检索，等于卡死。
 */
const topKeyword = ref(props.keyword);

function doRequeryAll() {
  const kw = topKeyword.value.trim();
  if (!kw) return;
  void anime.requeryAllSources(kw);
}

function statusInfo(result: (typeof anime.sourceSearch)[number]): {
  text: string;
  error?: boolean;
} {
  switch (result.status) {
    case "pending":
      return { text: t("anime.sourcePending") };
    case "success":
      return { text: `${result.items.length} ${t("anime.sourceResultCount")}` };
    case "error":
      return { text: result.message || t("anime.sourceError"), error: true };
    default:
      return {
        text: result.message
          ? `${t("anime.sourceNoResult")} · ${result.message}`
          : t("anime.sourceNoResult"),
      };
  }
}

/** 某源是否已展开（默认展开所有有结果的卡） */
function isExpanded(name: string) {
  if (expanded.value.has(name)) return true;
  const r = anime.sourceSearch.find((s) => s.pluginName === name);
  return r?.status === "success" && r.items.length > 0;
}

function toggle(name: string) {
  const next = new Set(expanded.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  expanded.value = next;
}

function toggleMore(name: string) {
  const next = new Set(moreOpen.value);
  if (next.has(name)) next.delete(name);
  else next.add(name);
  moreOpen.value = next;
}

function pick(pluginName: string, item: AnimeSearchItem) {
  emit("pick", pluginName, item);
}

/** 别名检索：在别名 list 里挑一个，重新查该源（结果替换该卡） */
function doAliasSearch(pluginName: string, alias: string) {
  moreOpen.value = new Set();
  void anime.requerySingleSource(pluginName, alias);
}

/** 手动检索：自定义关键字重查该源 */
function doManualSearch(pluginName: string) {
  const kw = (manualKeyword.value[pluginName] ?? "").trim();
  if (!kw) return;
  moreOpen.value = new Set();
  void anime.requerySingleSource(pluginName, kw);
}

/** 在系统浏览器打开该源按关键字搜索的页面（照 Kazumi 在浏览器中打开） */
function openInBrowser(pluginName: string) {
  const entry = anime.rules.find((r) => r.name === pluginName);
  let url = "";
  if (entry?.json) {
    try {
      const rule = normalizeRule(JSON.parse(entry.json));
      if (rule.searchURL) url = renderTemplate(rule.searchURL, { keyword: props.keyword });
      else url = rule.baseURL;
    } catch {
      url = "";
    }
  }
  moreOpen.value = new Set();
  if (url) void capabilities.openUrl(url);
}

/** 当前卡片没有结果时可提示的别名（照 Kazumi 别名检索候选） */
const aliasList = computed(() => props.subject?.alias?.slice(0, 12) ?? []);
</script>

<template>
  <Teleport to="body">
    <div class="scrim" @click.self="emit('close')">
      <div class="sheet">
        <div class="sheet-head">
          <span class="sheet-title">{{ t("anime.sourceSheetTitle") }}</span>
          <button class="close" :title="t('anime.exit')" @click="emit('close')">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="kw-row">
          <input
            v-model="topKeyword"
            :placeholder="t('anime.manualSearch')"
            @keyup.enter="doRequeryAll"
          />
          <button
            class="lm-btn lm-btn--tonal"
            :disabled="anime.sourceSearching"
            @click="doRequeryAll"
          >
            <span v-if="anime.sourceSearching" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else class="material-symbols-outlined">search</span>
          </button>
        </div>

        <p v-if="anime.sourceSearchError" class="state error">
          {{ anime.sourceSearchError }}
        </p>

        <p v-else-if="anime.sourceSearching && !anime.sourceSearch.length" class="state">
          {{ t("anime.choosingSource") }}
        </p>

        <div v-else-if="!anime.sourceSearch.length" class="state">
          {{ t("anime.noSource") }}
        </div>

        <div v-else class="cards">
          <div v-for="result in anime.sourceSearch" :key="result.pluginName" class="card">
            <!-- 卡片头：源名 + 状态 -->
            <button class="card-head" @click="toggle(result.pluginName)">
              <span class="src-name">{{ result.pluginName }}</span>
              <span
                class="src-status"
                :class="{ error: statusInfo(result).error }"
                :title="statusInfo(result).text"
                >{{ statusInfo(result).text }}</span
              >
              <span v-if="result.status === 'pending'" class="material-symbols-outlined spin"
                >progress_activity</span
              >
              <span v-else class="material-symbols-outlined chevron">expand_more</span>
            </button>

            <!-- 命中条目 -->
            <button
              v-for="(item, i) in result.items.slice(0, 12)"
              v-show="isExpanded(result.pluginName)"
              :key="i"
              class="result-row"
              @click="pick(result.pluginName, item)"
            >
              <span class="row-name">{{ item.name }}</span>
              <span class="material-symbols-outlined">play_arrow</span>
            </button>

            <!-- 更多操作 -->
            <div v-show="isExpanded(result.pluginName)" class="more-area">
              <button class="more-toggle" @click="toggleMore(result.pluginName)">
                <span class="material-symbols-outlined">more_vert</span>
              </button>

              <div v-if="moreOpen.has(result.pluginName)" class="more-panel">
                <div class="more-actions">
                  <button
                    v-if="aliasList.length"
                    class="act"
                    @click="doAliasSearch(result.pluginName, aliasList[0])"
                  >
                    {{ t("anime.aliasSearch") }}
                  </button>
                  <button class="act" @click="doManualSearch(result.pluginName)">
                    {{ t("anime.manualSearch") }}
                  </button>
                  <button class="act" @click="openInBrowser(result.pluginName)">
                    {{ t("anime.openInBrowser") }}
                  </button>
                </div>
                <div v-if="aliasList.length" class="alias-row">
                  <span
                    v-for="a in aliasList"
                    :key="a"
                    class="alias-chip"
                    @click="doAliasSearch(result.pluginName, a)"
                    >{{ a }}</span
                  >
                </div>
                <div class="manual-row">
                  <input
                    v-model="manualKeyword[result.pluginName]"
                    :placeholder="t('anime.manualSearch')"
                    @keyup.enter="doManualSearch(result.pluginName)"
                  />
                  <button class="lm-btn lm-btn--tonal" @click="doManualSearch(result.pluginName)">
                    <span class="material-symbols-outlined">search</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.scrim {
  position: fixed;
  inset: 0;
  z-index: 190;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  background: rgba(0, 0, 0, 0.42);
  animation: lm-fade-in 180ms var(--md-sys-motion-spring-effects-fast);
}
.sheet {
  width: min(680px, 100vw);
  max-height: 86vh;
  overflow-y: auto;
  padding: 16px 18px;
  border-radius: var(--md-sys-shape-corner-extra-large) var(--md-sys-shape-corner-extra-large) 0 0;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  box-shadow: var(--md-elevation-3);
  animation: rise 240ms var(--md-sys-motion-spring-spatial) both;
}
.sheet-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}
.sheet-title {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.close {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.close:hover {
  background: var(--md-sys-color-surface-container);
}
.state {
  padding: 32px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-line;
}
.state.error {
  padding: 16px 0;
  color: var(--md-sys-color-error);
}
.kw-row {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}
.kw-row input {
  flex: 1;
  min-width: 0;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  outline: none;
}
.cards {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card {
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  overflow: hidden;
}
.card-head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 14px;
  border: none;
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.card-head:hover {
  background: var(--md-sys-color-surface-container-high);
}
.src-name {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-status {
  flex: none;
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
  max-width: 48%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.src-status.error {
  color: var(--md-sys-color-error);
}
.card-head .material-symbols-outlined {
  flex: none;
  font-size: 18px;
  color: var(--md-sys-color-on-surface-variant);
}
.card-head .chevron {
  transition: transform 220ms var(--md-sys-motion-spring-spatial-fast);
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
.result-row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 12px 16px;
  border: none;
  border-top: 1px solid var(--lm-hairline);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.result-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.row-name {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.result-row .material-symbols-outlined {
  flex: none;
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.more-area {
  position: relative;
  border-top: 1px solid var(--lm-hairline);
  padding: 6px 8px;
}
.more-toggle {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  margin-left: auto;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.more-toggle:hover {
  background: var(--md-sys-color-surface-container-high);
}
.more-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 8px 10px;
}
.more-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.act {
  padding: 5px 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
}
.act:hover {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
}
.alias-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.alias-chip {
  padding: 3px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
  cursor: pointer;
}
.alias-chip:hover {
  color: var(--md-sys-color-primary);
}
.manual-row {
  display: flex;
  gap: 6px;
}
.manual-row input {
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-small-size);
  outline: none;
}
@keyframes lm-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@keyframes rise {
  from {
    transform: translateY(24px);
    opacity: 0;
  }
}
</style>
