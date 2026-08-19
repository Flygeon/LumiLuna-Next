<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import PageHeader from "@/components/PageHeader.vue";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { NovelDailyStat, NovelSourceStat, NovelTopBook } from "@shared/types";

const settings = useSettingsStore();
const router = useRouter();
const t = (key: string) => translate(settings.lang, key);

const loading = ref(true);
const today = ref<NovelDailyStat | null>(null);
const trend = ref<NovelDailyStat[]>([]);
const sources = ref<NovelSourceStat[]>([]);
const topBooks = ref<NovelTopBook[]>([]);

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}小时${m}分`;
  return `${m}分${s % 60}秒`;
}

function formatCount(v: number): string {
  return v >= 10_000 ? `${(v / 10_000).toFixed(1)}万` : String(v);
}

async function load() {
  loading.value = true;
  try {
    const [todayStat, trendList, sourceList, topList] = await Promise.all([
      capabilities.novelStatsGet(),
      capabilities.novelStatsList(30),
      capabilities.novelSourceBreakdown(30),
      capabilities.novelTopBooks(20, 30),
    ]);
    today.value = todayStat;
    trend.value = trendList;
    sources.value = sourceList;
    topBooks.value = topList;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="view">
    <PageHeader :title="t('novelStats.title')" :description="t('novelStats.subtitle')" />
    <div v-if="loading" class="state">{{ t("novelStats.loading") }}</div>

    <template v-else>
      <div class="overview">
        <div class="stat-card">
          <span class="stat-icon material-symbols-outlined">today</span>
          <div class="stat-value">{{ today?.readCount ?? 0 }}</div>
          <div class="stat-label">{{ t("novelStats.todayCount") }}</div>
        </div>
        <div class="stat-card">
          <span class="stat-icon material-symbols-outlined">schedule</span>
          <div class="stat-value">{{ formatDuration(today?.totalMs ?? 0) }}</div>
          <div class="stat-label">{{ t("novelStats.todayDuration") }}</div>
        </div>
        <div class="stat-card">
          <span class="stat-icon material-symbols-outlined">menu_book</span>
          <div class="stat-value">{{ trend.reduce((sum, d) => sum + d.uniqueBooks, 0) }}</div>
          <div class="stat-label">{{ t("novelStats.recentBooks") }}</div>
        </div>
      </div>

      <!-- 每日趋势 -->
      <section class="card">
        <h3 class="card-title">{{ t("novelStats.trend") }}</h3>
        <div v-if="trend.length === 0" class="state">{{ t("novelStats.empty") }}</div>
        <div v-else class="trend-bars">
          <div v-for="d in trend" :key="d.day" class="bar-col">
            <div class="bar" :style="{ height: Math.max(4, (d.totalMs / Math.max(...trend.map(x => x.totalMs), 1)) * 80) + 'px' }" :title="`${d.day}: ${formatDuration(d.totalMs)}`"></div>
            <span class="bar-label">{{ d.day.slice(5) }}</span>
          </div>
        </div>
      </section>

      <!-- 本地/在线占比 -->
      <section class="card">
        <h3 class="card-title">{{ t("novelStats.source") }}</h3>
        <div v-if="sources.length === 0" class="state">{{ t("novelStats.empty") }}</div>
        <div v-else class="source-list">
          <div v-for="s in sources" :key="s.source" class="source-row">
            <span class="source-name">{{ s.source === "online" ? t("novelStats.online") : t("novelStats.local") }}</span>
            <span class="source-value">{{ s.readCount }} · {{ formatDuration(s.totalMs) }}</span>
          </div>
        </div>
      </section>

      <!-- 最近在读 / Top -->
      <section class="card">
        <h3 class="card-title">{{ t("novelStats.topBooks") }}</h3>
        <div v-if="topBooks.length === 0" class="state">{{ t("novelStats.empty") }}</div>
        <div v-else class="book-list">
          <div v-for="(b, i) in topBooks" :key="b.bookId" class="book-row">
            <span class="rank">{{ i + 1 }}</span>
            <div class="book-main">
              <div class="book-title">{{ b.title }}</div>
              <div class="book-sub">{{ b.chapterTitle || b.source }}</div>
            </div>
            <span class="book-stat">{{ b.readCount }} · {{ formatDuration(b.totalMs) }}</span>
          </div>
        </div>
      </section>

      <div class="actions">
        <button class="lm-btn lm-btn--outlined" @click="router.push('/treasure')">
          {{ t("actions.cancel") }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.view {
  max-width: 760px;
  margin: 0 auto;
  padding-bottom: 40px;
}
.state {
  padding: 32px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.overview {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-bottom: 16px;
}
.stat-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 18px 12px;
  border-radius: var(--md-sys-shape-corner-large);
  background: var(--md-sys-color-surface-container);
}
.stat-icon {
  font-size: 24px;
  color: var(--md-sys-color-primary);
}
.stat-value {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
}
.stat-label {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.card {
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--md-sys-shape-corner-large);
  padding: 18px 20px;
  margin-bottom: 16px;
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.card-title {
  margin: 0 0 14px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.trend-bars {
  display: flex;
  align-items: flex-end;
  gap: 4px;
  height: 100px;
  overflow-x: auto;
}
.bar-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
  flex: 1 0 14px;
  gap: 4px;
}
.bar {
  width: 10px;
  border-radius: 4px 4px 0 0;
  background: var(--md-sys-color-primary);
}
.bar-label {
  font-size: 9px;
  color: var(--md-sys-color-on-surface-variant);
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.source-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 10px 12px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  font-size: var(--md-sys-typescale-body-medium-size);
}
.source-value {
  color: var(--md-sys-color-on-surface-variant);
}
.book-list {
  display: flex;
  flex-direction: column;
}
.book-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 0;
  border-bottom: 1px solid var(--lm-hairline);
}
.book-row:last-child {
  border-bottom: none;
}
.rank {
  flex: none;
  width: 24px;
  text-align: center;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
}
.book-main {
  flex: 1;
  min-width: 0;
}
.book-title {
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-sub {
  margin-top: 2px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.book-stat {
  flex: none;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.actions {
  display: flex;
  justify-content: center;
  margin-top: 8px;
}
</style>