<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { usePlayerStore } from "@/stores/player";
import { useSettingsStore } from "@/stores/settings";
import { capabilities, isTauri } from "@/capabilities";
import { formatListenDuration, formatDuration } from "@/utils/format";
import { translate } from "@shared/i18n";
import type {
  ListenSourceStat,
  ListenStats,
  TopTrackStat,
} from "@shared/types";

const settings = useSettingsStore();
const player = usePlayerStore();
const router = useRouter();

// ── 类型 ──────────────────────────────────────────────────────
type PeriodKey = "7" | "30" | "all" | "custom";
type SourceFilter = "all" | "local" | "online" | "webdav";
type TrackSortKey = "plays" | "duration" | "title" | "artist";
type LimitKey = "20" | "50" | "100";

const PERIODS: { id: PeriodKey; label: string; days: number | null }[] = [
  { id: "7", label: "stats.period7", days: 7 },
  { id: "30", label: "stats.period30", days: 30 },
  { id: "all", label: "stats.periodAll", days: null },
  { id: "custom", label: "stats.custom", days: null },
];

const SOURCE_OPTIONS: { value: SourceFilter; label: string }[] = [
  { value: "all", label: "stats.sourceAll" },
  { value: "local", label: "stats.sourceLocal" },
  { value: "online", label: "stats.sourceOnline" },
  { value: "webdav", label: "stats.sourceWebdav" },
];

const SORT_OPTIONS: { value: TrackSortKey; label: string }[] = [
  { value: "plays", label: "stats.sortPlays" },
  { value: "duration", label: "stats.sortDuration" },
  { value: "title", label: "stats.sortTitle" },
  { value: "artist", label: "stats.sortArtist" },
];

const LIMIT_OPTIONS: { value: LimitKey; label: string }[] = [
  { value: "20", label: "stats.limit20" },
  { value: "50", label: "stats.limit50" },
  { value: "100", label: "stats.limit100" },
];

const LIMIT_VALUE: Record<LimitKey, number> = { "20": 20, "50": 50, "100": 100 };

// ── 状态 ──────────────────────────────────────────────────────
const period = ref<PeriodKey>("7");
const fromDate = ref("");
const toDate = ref("");
const sourceFilter = ref<SourceFilter>("all");
const trackSort = ref<TrackSortKey>("plays");
const limitKey = ref<LimitKey>("20");
const query = ref("");
const today = ref<ListenStats | null>(null);
const recent = ref<ListenStats[]>([]);
const periodTotals = ref({ plays: 0, ms: 0 });
const sources = ref<ListenSourceStat[]>([]);
const topTracks = ref<TopTrackStat[]>([]);
const loading = ref(true);

// ── 日期工具 ──────────────────────────────────────────────────
function localYmd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateStr(offsetDays: number): string {
  const d = new Date();
  d.setDate(d.getDate() - offsetDays);
  return localYmd(d);
}

function emptyDay(day: string): ListenStats {
  return { day, playCount: 0, uniqueTracks: 0, totalMs: 0 };
}

function fillRecentDays(rows: ListenStats[], days: number): ListenStats[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: ListenStats[] = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const key = localYmd(d);
    out.push(map.get(key) ?? emptyDay(key));
  }
  return out;
}

function sumRows(rows: ListenStats[]): { plays: number; ms: number } {
  return rows.reduce(
    (acc, r) => ({ plays: acc.plays + r.playCount, ms: acc.ms + r.totalMs }),
    { plays: 0, ms: 0 },
  );
}

function matchesQuery(track: TopTrackStat, q: string): boolean {
  if (!q) return true;
  const lower = q.toLowerCase();
  return [track.title, track.artist, track.album]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(lower);
}

function sortClusters(rows: TopTrackStat[], sort: TrackSortKey): TopTrackStat[] {
  const next = [...rows];
  next.sort((a, b) => {
    if (sort === "plays") {
      return b.playCount - a.playCount || b.totalMs - a.totalMs || a.title.localeCompare(b.title, "zh-CN");
    }
    if (sort === "duration") {
      return b.totalMs - a.totalMs || b.playCount - a.playCount || a.title.localeCompare(b.title, "zh-CN");
    }
    if (sort === "artist") {
      return (a.artist || "").localeCompare(b.artist || "", "zh-CN") || b.playCount - a.playCount;
    }
    return a.title.localeCompare(b.title, "zh-CN") || b.playCount - a.playCount;
  });
  return next;
}

// 本地按去扩展名文件名聚类
function clusterTopTracks(rows: TopTrackStat[]): TopTrackStat[] {
  if (rows.length === 0) return [];
  const groups = new Map<string, TopTrackStat[]>();
  for (const row of rows) {
    const key = row.source === "local"
      ? (row.fileName ? row.fileName.replace(/\.[^.]+$/, "").toLowerCase() : row.trackId)
      : row.trackId;
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  const out: TopTrackStat[] = [];
  for (const members of groups.values()) {
    members.sort((a, b) => b.playCount - a.playCount || b.totalMs - a.totalMs);
    const primary = members[0]!;
    out.push({
      ...primary,
      playCount: members.reduce((s, m) => s + m.playCount, 0),
      totalMs: members.reduce((s, m) => s + m.totalMs, 0),
    });
  }
  out.sort((a, b) => b.playCount - a.playCount || b.totalMs - a.totalMs);
  return out;
}

// ── 计算属性 ──────────────────────────────────────────────────
const periodMeta = computed(() => PERIODS.find((p) => p.id === period.value) ?? PERIODS[0]!);
const isCustom = computed(() => period.value === "custom");

const chartDays = computed(() => {
  if (isCustom.value && fromDate.value && toDate.value) {
    const diff = (Date.parse(toDate.value) - Date.parse(fromDate.value)) / 86_400_000;
    return Math.max(1, Math.min(90, Math.round(diff) + 1));
  }
  return periodMeta.value.days ?? 30;
});

const topDays = computed(() => (isCustom.value ? null : periodMeta.value.days));

const from = computed(() => (isCustom.value ? fromDate.value : undefined));
const to = computed(() => (isCustom.value ? toDate.value : undefined));

const heroLabel = computed(() => {
  if (isCustom.value) return `${fromDate.value} 至 ${toDate.value}`;
  const labels: Record<string, string> = { "7": "过去 7 天", "30": "过去 30 天", all: "全部时间" };
  return labels[period.value] ?? "全部时间";
});

const dailyAvgMs = computed(() => {
  const days = periodMeta.value.days ?? Math.max(recent.value.length, 1);
  return Math.round(periodTotals.value.ms / Math.max(1, days));
});

function splitListenDuration(ms: number): { primary: string; unit: string } {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  if (totalMin < 60) return { primary: String(totalMin), unit: "分钟" };
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (mins === 0) return { primary: String(hours), unit: "小时" };
  return { primary: String(hours), unit: `小时 ${mins} 分` };
}

const heroParts = computed(() => splitListenDuration(periodTotals.value.ms));

const filteredTracks = computed(() => {
  let rows = topTracks.value;
  if (sourceFilter.value !== "all") {
    rows = rows.filter((r) => r.source === sourceFilter.value);
  }
  const q = query.value.trim();
  if (q) rows = rows.filter((r) => matchesQuery(r, q));
  return sortClusters(rows, trackSort.value).slice(0, LIMIT_VALUE[limitKey.value]);
});

// ── 数据加载 ──────────────────────────────────────────────────
async function loadData() {
  if (!isTauri) {
    loading.value = false;
    return;
  }
  loading.value = true;
  try {
    const [dayData, chartList, periodList, tops, mix] = await Promise.all([
      capabilities.getListenStats(),
      capabilities.listListenStats(chartDays.value, from.value, to.value),
      isCustom.value
        ? capabilities.listListenStats(90, from.value, to.value)
        : topDays.value
          ? capabilities.listListenStats(topDays.value)
          : capabilities.listListenStats(90),
      capabilities.listTopTracks(100, topDays.value, from.value, to.value),
      capabilities.listenSourceBreakdown(topDays.value, from.value, to.value),
    ]);
    today.value = dayData;
    const filled = fillRecentDays(chartList, chartDays.value);
    recent.value = filled;
    if (topDays.value) {
      periodTotals.value = sumRows(fillRecentDays(periodList, topDays.value));
    } else {
      periodTotals.value = sumRows(periodList);
    }
    topTracks.value = clusterTopTracks(tops);
    sources.value = mix;
  } catch {
    // 加载失败不阻塞 UI
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  if (!fromDate.value) fromDate.value = dateStr(29);
  if (!toDate.value) toDate.value = dateStr(0);
  void loadData();
});

watch(
  [period, chartDays, topDays, from, to],
  () => void loadData(),
  { deep: false },
);

// ── 播放 ──────────────────────────────────────────────────────
function playTrack(track: TopTrackStat) {
  if (track.source === "local") {
    void player.loadById(track.trackId);
  } else if (track.source === "webdav" && track.filePath) {
    player.loadWebDavSong({
      name: track.fileName || track.title || "",
      path: track.filePath,
      isDir: false,
      size: 0,
      mtime: 0,
    });
  }
  // online 歌曲暂不支持从统计页直接播放（URL 可能过期）
}

// ── 翻译 ──────────────────────────────────────────────────────
function t(key: string) {
  return translate(settings.lang, key);
}

// ── 图表数据 ──────────────────────────────────────────────────
const trendData = computed(() =>
  recent.value.map((r) => ({
    day: r.day,
    label: r.day.slice(5),
    plays: r.playCount,
    minutes: Math.round(r.totalMs / 60_000),
    totalMs: r.totalMs,
  })),
);

const hasTrendData = computed(() => trendData.value.some((d) => d.plays > 0));

const sourceData = computed(() => {
  const total = sources.value.reduce((s, r) => s + r.playCount, 0);
  const colors: Record<string, string> = {
    local: "var(--md-sys-color-primary)",
    online: "#5b8def",
    webdav: "#8b5cf6",
  };
  return sources.value.map((r) => ({
    source: r.source,
    name: t(`stats.source${r.source.charAt(0).toUpperCase() + r.source.slice(1)}`),
    playCount: r.playCount,
    totalMs: r.totalMs,
    pct: total > 0 ? Math.round((r.playCount / total) * 100) : 0,
    color: colors[r.source] ?? "#666",
  }));
});

const hasSourceData = computed(() => sourceData.value.length > 0);

// 环形图分段：预计算每个扇区的起止角度
const donutSegments = computed(() => {
  const total = sources.value.reduce((s, r) => s + r.playCount, 0);
  if (total === 0) return [];
  let start = 0;
  const colors: Record<string, string> = {
    local: "var(--md-sys-color-primary)",
    online: "#5b8def",
    webdav: "#8b5cf6",
  };
  return sources.value.map((r) => {
    const angle = (r.playCount / total) * 360;
    const seg = { source: r.source, start, end: start + angle, color: colors[r.source] ?? "#666" };
    start += angle;
    return seg;
  });
});

function piePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number,
): string {
  const start = ((startAngle - 90) * Math.PI) / 180;
  const end = ((endAngle - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}
</script>

<template>
  <div class="view">
    <header class="page-head">
      <h2>{{ t("nav.stats") }}</h2>
      <div class="period-tabs" v-if="isTauri">
        <button
          v-for="p in PERIODS"
          :key="p.id"
          class="period-tab"
          :class="{ active: period === p.id }"
          @click="period = p.id"
        >
          {{ t(p.label) }}
        </button>
      </div>
    </header>

    <!-- 自定义日期 -->
    <div v-if="isTauri && isCustom" class="custom-date-row">
      <input
        type="date"
        :value="fromDate"
        @change="(e) => { fromDate = (e.target as HTMLInputElement).value; void loadData(); }"
        class="date-input"
      />
      <span class="date-sep">~</span>
      <input
        type="date"
        :value="toDate"
        @change="(e) => { toDate = (e.target as HTMLInputElement).value; void loadData(); }"
        class="date-input"
      />
    </div>

    <!-- 非 Tauri 空态 -->
    <div v-if="!isTauri" class="empty-state">
      <span class="material-symbols-outlined empty-icon">bar_chart</span>
      <p>{{ t("stats.desktopOnly") }}</p>
    </div>

    <!-- 加载骨架 -->
    <div v-else-if="loading" class="skeleton">
      <div class="sk-hero"></div>
      <div class="sk-row">
        <div class="sk-cell"></div>
        <div class="sk-cell"></div>
        <div class="sk-cell"></div>
      </div>
      <div class="sk-chart"></div>
      <div class="sk-chart"></div>
    </div>

    <!-- 内容 -->
    <template v-else>
      <!-- Hero -->
      <section class="hero-section">
        <p class="hero-label">{{ heroLabel }}</p>
        <div class="hero-number">
          <span class="hero-primary">{{ heroParts.primary }}</span>
          <span class="hero-unit">{{ heroParts.unit }}</span>
        </div>
        <p class="hero-sub">
          <span class="num">{{ periodTotals.plays.toLocaleString() }}</span>
          {{ t("stats.totalPlays") }}
          <span class="sep">·</span>
          {{ t("stats.dailyAvg") }}
          <span class="num">{{ formatListenDuration(dailyAvgMs) }}</span>
        </p>
      </section>

      <!-- 今日 -->
      <section class="metrics-section">
        <h3 class="section-label">{{ t("stats.today") }}</h3>
        <div class="metrics-grid">
          <div class="metric-cell">
            <p class="metric-label">{{ t("stats.plays") }}</p>
            <p class="metric-value">{{ today?.playCount ?? 0 }}</p>
          </div>
          <div class="metric-cell bordered">
            <p class="metric-label">{{ t("stats.tracks") }}</p>
            <p class="metric-value">{{ today?.uniqueTracks ?? 0 }}</p>
          </div>
          <div class="metric-cell bordered">
            <p class="metric-label">{{ t("stats.duration") }}</p>
            <p class="metric-value compact">{{ formatListenDuration(today?.totalMs ?? 0) }}</p>
          </div>
        </div>
      </section>

      <!-- 活动趋势图表 -->
      <section class="chart-section">
        <div class="chart-header">
          <h3 class="section-label large">{{ t("stats.activity") }}</h3>
          <span class="chart-caption">
            {{ period === "all" ? "近 30 天" : `近 ${chartDays} 天` }}
          </span>
        </div>
        <div class="chart-grid">
          <!-- 柱状图：播放 -->
          <div class="chart-card">
            <p class="chart-title">{{ t("stats.plays") }}</p>
            <div v-if="!hasTrendData" class="chart-empty">
              <p>{{ t("stats.noData") }}</p>
            </div>
            <svg v-else class="chart-svg" viewBox="0 0 360 160" preserveAspectRatio="xMidYMid meet">
              <g transform="translate(0, 160) scale(1, -1)">
                <rect
                  v-for="(d, i) in trendData"
                  :key="d.day"
                  :x="i * (360 / Math.max(trendData.length, 1)) + 4"
                  :y="0"
                  :width="Math.max(4, 360 / Math.max(trendData.length, 1) - 8)"
                  :height="d.plays > 0 ? Math.max(3, (d.plays / Math.max(...trendData.map((x) => x.plays), 1)) * 130) : 0"
                  fill="var(--md-sys-color-primary)"
                  rx="3"
                />
              </g>
            </svg>
          </div>
          <!-- 面积图：时长 -->
          <div class="chart-card">
            <p class="chart-title">{{ t("stats.duration") }}</p>
            <div v-if="!hasTrendData" class="chart-empty">
              <p>{{ t("stats.noData") }}</p>
            </div>
            <svg v-else class="chart-svg" viewBox="0 0 360 160" preserveAspectRatio="xMidYMid meet">
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stop-color="var(--md-sys-color-primary)" stop-opacity="0.32" />
                  <stop offset="100%" stop-color="var(--md-sys-color-primary)" stop-opacity="0.02" />
                </linearGradient>
              </defs>
              <g transform="translate(0, 160) scale(1, -1)">
                <polygon
                  :points="
                    '0,0 ' +
                    trendData.map((d, i) => {
                      const x = i * (360 / Math.max(trendData.length, 1)) + 360 / Math.max(trendData.length, 1) / 2;
                      const maxMs = Math.max(...trendData.map((x) => x.totalMs), 1);
                      const y = d.totalMs > 0 ? (d.totalMs / maxMs) * 130 : 0;
                      return `${x},${y}`;
                    }).join(' ') +
                    ' 360,0'
                  "
                  fill="url(#areaGrad)"
                />
                <polyline
                  :points="
                    trendData.map((d, i) => {
                      const x = i * (360 / Math.max(trendData.length, 1)) + 360 / Math.max(trendData.length, 1) / 2;
                      const maxMs = Math.max(...trendData.map((x) => x.totalMs), 1);
                      const y = d.totalMs > 0 ? (d.totalMs / maxMs) * 130 : 0;
                      return `${x},${y}`;
                    }).join(' ')
                  "
                  fill="none"
                  stroke="var(--md-sys-color-primary)"
                  stroke-width="2"
                  stroke-linejoin="round"
                />
              </g>
            </svg>
          </div>
        </div>
      </section>

      <!-- 来源分布 -->
      <section class="source-section">
        <h3 class="section-label large">{{ t("stats.source") }}</h3>
        <div class="source-card">
          <div v-if="!hasSourceData" class="chart-empty">
            <p>{{ t("stats.noDataHint") }}</p>
          </div>
          <template v-else>
            <div class="source-donut-area">
              <svg class="donut-svg" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="40" fill="none" stroke="var(--md-sys-color-surface-container-high)" stroke-width="16" />
                <path
                  v-for="seg in donutSegments"
                  :key="seg.source"
                  :d="piePath(50, 50, 40, seg.start, seg.end)"
                  :fill="seg.color"
                  opacity="0.85"
                />
              </svg>
              <div class="donut-center">
                <span class="donut-total">{{ sources.reduce((s, r) => s + r.playCount, 0) }}</span>
              </div>
            </div>
            <div class="source-legend">
              <div v-for="s in sourceData" :key="s.source" class="legend-item">
                <div class="legend-bar">
                  <span class="legend-dot" :style="{ background: s.color }"></span>
                  <span class="legend-name">{{ s.name }}</span>
                </div>
                <div class="legend-stats">
                  <span class="legend-pct">{{ s.pct }}%</span>
                  <span class="legend-sep">·</span>
                  <span>{{ s.playCount }} {{ t("stats.times") }}</span>
                </div>
              </div>
              <div class="legend-total">
                <span>{{ t("stats.duration") }}：{{ formatListenDuration(sources.reduce((s, r) => s + r.totalMs, 0)) }}</span>
              </div>
            </div>
          </template>
        </div>
      </section>

      <!-- 常听排行 -->
      <section class="top-section">
        <div class="top-header">
          <h3 class="section-label large">{{ t("stats.topTracks") }}</h3>
          <span v-if="filteredTracks.length > 0" class="top-count">{{ filteredTracks.length }} 首</span>
        </div>

        <!-- 控制栏 -->
        <div class="top-controls">
          <div class="search-box">
            <span class="material-symbols-outlined search-icon">search</span>
            <input
              v-model="query"
              :placeholder="t('stats.searchPlaceholder')"
              class="search-input"
            />
          </div>
          <div class="sort-group">
            <select v-model="sourceFilter" class="sort-select" :title="t('stats.sourceAll')">
              <option v-for="opt in SOURCE_OPTIONS" :key="opt.value" :value="opt.value">{{ t(opt.label) }}</option>
            </select>
            <select v-model="trackSort" class="sort-select" :title="t('stats.sortPlays')">
              <option v-for="opt in SORT_OPTIONS" :key="opt.value" :value="opt.value">{{ t(opt.label) }}</option>
            </select>
            <select v-model="limitKey" class="sort-select" :title="t('stats.limit20')">
              <option v-for="opt in LIMIT_OPTIONS" :key="opt.value" :value="opt.value">{{ t(opt.label) }}</option>
            </select>
          </div>
        </div>

        <!-- 列表 -->
        <div v-if="filteredTracks.length === 0" class="empty-list">
          <p>{{ topTracks.length === 0 ? t("stats.noDataHint") : t("stats.noMatchHint") }}</p>
        </div>
        <div v-else class="track-list">
          <div
            v-for="(track, index) in filteredTracks"
            :key="track.trackId + '-' + track.source"
            class="track-row"
            :class="{ active: player.song?.id === track.trackId }"
            @click="playTrack(track)"
          >
            <span class="rank" :class="{ top3: index < 3 }">{{ index + 1 }}</span>
            <div class="track-info">
              <p class="track-title">{{ track.title }}</p>
              <p class="track-artist">{{ track.artist || "未知艺人" }}</p>
            </div>
            <span class="track-source-badge" :class="'source-' + track.source">
              {{ track.source === "local" ? t("stats.sourceLocal") : track.source === "online" ? t("stats.sourceOnline") : t("stats.sourceWebdav") }}
            </span>
            <span class="track-plays">{{ track.playCount }}<span class="plays-unit"> {{ t("stats.times") }}</span></span>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.view {
  min-height: 100%;
  padding-bottom: 32px;
}

/* 头顶 */
.page-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 20px;
  flex-wrap: wrap;
}
.page-head h2 {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  margin: 0;
}

/* 时段分段 */
.period-tabs {
  display: inline-flex;
  gap: 2px;
  padding: 3px;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-high);
}
.period-tab {
  padding: 6px 14px;
  border: none;
  border-radius: 999px;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.period-tab.active {
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  box-shadow: 0 1px 3px rgba(0,0,0,0.08);
}
.period-tab:hover {
  color: var(--md-sys-color-on-surface);
}

/* 自定义日期 */
.custom-date-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
}
.date-input {
  padding: 6px 10px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: 8px;
  font-size: 13px;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}
.date-sep {
  color: var(--md-sys-color-on-surface-variant);
}

/* 空态 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 240px;
  color: var(--md-sys-color-on-surface-variant);
  gap: 12px;
}
.empty-icon {
  font-size: 48px;
  opacity: 0.5;
}

/* 骨架 */
.skeleton {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.sk-hero {
  height: 120px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container-high);
  opacity: 0.5;
}
.sk-row {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.sk-cell {
  height: 80px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container-high);
  opacity: 0.4;
}
.sk-chart {
  height: 180px;
  border-radius: 16px;
  background: var(--md-sys-color-surface-container-high);
  opacity: 0.3;
}

/* Hero */
.hero-section {
  padding: 0 4px;
  margin-bottom: 28px;
}
.hero-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 6px;
}
.hero-number {
  display: flex;
  align-items: flex-end;
  gap: 6px;
  line-height: 1;
}
.hero-primary {
  font-size: 64px;
  font-weight: 700;
  letter-spacing: -0.055em;
  color: var(--md-sys-color-on-surface);
}
.hero-unit {
  font-size: 28px;
  font-weight: 600;
  letter-spacing: -0.035em;
  color: var(--md-sys-color-on-surface);
  opacity: 0.8;
  margin-bottom: 6px;
}
.hero-sub {
  margin: 8px 0 0;
  font-size: 15px;
  color: var(--md-sys-color-on-surface-variant);
}
.hero-sub .num {
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.hero-sub .sep {
  margin: 0 8px;
  opacity: 0.3;
}

/* 今日指标 */
.metrics-section {
  margin-bottom: 24px;
}
.section-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
  margin: 0 0 10px 4px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.section-label.large {
  font-size: 22px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
  text-transform: none;
  letter-spacing: -0.03em;
}
.metrics-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  border-radius: 22px;
  overflow: hidden;
  background: var(--md-sys-color-surface-container-high);
}
.metric-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 18px 8px;
  gap: 4px;
}
.metric-cell.bordered {
  border-left: 1px solid var(--md-sys-color-outline-variant);
}
.metric-label {
  font-size: 12px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  margin: 0;
}
.metric-value {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--md-sys-color-on-surface);
  margin: 0;
}
.metric-value.compact {
  font-size: 17px;
}

/* 图表 */
.chart-section {
  margin-bottom: 24px;
}
.chart-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.chart-caption {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  padding-bottom: 2px;
}
.chart-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: 1fr 1fr;
}
@media (max-width: 640px) {
  .chart-grid {
    grid-template-columns: 1fr;
  }
}
.chart-card {
  background: var(--md-sys-color-surface-container-high);
  border-radius: 22px;
  padding: 16px 12px 12px;
}
.chart-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 10px;
  color: var(--md-sys-color-on-surface);
}
.chart-svg {
  width: 100%;
  height: 160px;
}
.chart-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 160px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}
.chart-empty p {
  margin: 0;
}

/* 来源 */
.source-section {
  margin-bottom: 24px;
}
.source-card {
  background: var(--md-sys-color-surface-container-high);
  border-radius: 22px;
  padding: 20px;
  display: flex;
  gap: 24px;
  align-items: center;
  flex-wrap: wrap;
}
.source-donut-area {
  position: relative;
  flex-shrink: 0;
  width: 140px;
  height: 140px;
}
.donut-svg {
  width: 100%;
  height: 100%;
}
.donut-center {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.donut-total {
  font-size: 17px;
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
}
.source-legend {
  flex: 1;
  min-width: 140px;
}
.legend-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
  font-size: 14px;
}
.legend-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.legend-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.legend-name {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.legend-stats {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
}
.legend-pct {
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.legend-sep {
  margin: 0 4px;
  opacity: 0.3;
}
.legend-total {
  margin-top: 8px;
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}

/* 常听排行 */
.top-section {
  margin-bottom: 24px;
}
.top-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
  margin-bottom: 12px;
}
.top-count {
  font-size: 13px;
  color: var(--md-sys-color-on-surface-variant);
}
.top-controls {
  display: flex;
  gap: 10px;
  margin-bottom: 12px;
  flex-wrap: wrap;
  align-items: center;
}
.search-box {
  position: relative;
  flex: 1;
  min-width: 160px;
}
.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 15px;
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.65;
  pointer-events: none;
}
.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  border: none;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-size: 14px;
  font-family: inherit;
  outline: none;
}
.search-input::placeholder {
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.55;
}
.sort-group {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
}
.sort-select {
  padding: 6px 12px;
  border: none;
  border-radius: 999px;
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  font-family: inherit;
  outline: none;
}
.sort-select:hover {
  background: var(--md-sys-color-surface-container-highest);
}

/* 排行列表 */
.track-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: 22px;
  padding: 6px;
}
.empty-list {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: 22px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 14px;
}
.track-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 14px;
  cursor: pointer;
  transition: background 0.15s;
}
.track-row:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.track-row.active {
  background: var(--md-sys-color-secondary-container);
}
.rank {
  width: 24px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  flex-shrink: 0;
}
.rank.top3 {
  font-weight: 700;
  color: var(--md-sys-color-on-surface);
}
.track-info {
  flex: 1;
  min-width: 0;
}
.track-title {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-artist {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.track-source-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 500;
  flex-shrink: 0;
}
.source-local {
  background: color-mix(in srgb, var(--md-sys-color-primary) 15%, transparent);
  color: var(--md-sys-color-primary);
}
.source-online {
  background: color-mix(in srgb, #5b8def 15%, transparent);
  color: #5b8def;
}
.source-webdav {
  background: color-mix(in srgb, #8b5cf6 15%, transparent);
  color: #8b5cf6;
}
.track-plays {
  font-size: 13px;
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  flex-shrink: 0;
}
.plays-unit {
  font-weight: 400;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
}
</style>