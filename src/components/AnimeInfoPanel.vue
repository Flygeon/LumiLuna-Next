<script setup lang="ts">
/**
 * 番剧详情面板（照 Kazumi InfoPage 概览 tab 复刻）：
 * 封面 + 标题（中文名主、原语名副）+ 评分/排名/放送日期/平台/总话数
 * + 简介 + 标签 + 别名，底部「开始观看」进入聚合搜索（SourceSheet）。
 */
import { computed, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useBangumiCollectStore } from "@/stores/bangumiCollect";
import { translate } from "@shared/i18n";
import type { BangumiCollectionCategory, BangumiSubject } from "@shared/types";

const props = defineProps<{
  subject: BangumiSubject | null;
  loading: boolean;
  error: string;
}>();

const emit = defineEmits<{
  (e: "back"): void;
  (e: "openSources"): void;
  (e: "openCollection"): void;
}>();

const settings = useSettingsStore();
const collect = useBangumiCollectStore();
const t = (key: string) => translate(settings.lang, key);

/**
 * 封面元素引用：暴露给父组件作为 hero 飞行过渡的降落点
 * （overlay 克隆层从来源卡片飞到这个位置，见 utils/heroTransition）。
 */
const coverEl = ref<HTMLElement | null>(null);
defineExpose({ coverEl });

/** 追番状态按钮：Bangumi 官方 CollectionType 五类 */
const STATUS_BTNS: { cat: Exclude<BangumiCollectionCategory, 0>; icon: string }[] = [
  { cat: 1, icon: "bookmark_add" },
  { cat: 3, icon: "play_circle" },
  { cat: 2, icon: "done_all" },
  { cat: 4, icon: "hourglass_bottom" },
  { cat: 5, icon: "do_not_disturb_on" },
];

const subjectId = computed(() => Number(props.subject?.id ?? 0));
const currentStatus = computed<BangumiCollectionCategory>(() =>
  subjectId.value ? collect.statusOf(subjectId.value) : 0,
);
const saving = computed(() => collect.savingIds.includes(subjectId.value));

async function pickStatus(cat: Exclude<BangumiCollectionCategory, 0>) {
  if (!subjectId.value || currentStatus.value === cat) return;
  await collect.setStatus(subjectId.value, cat, props.subject);
}

const title = computed(() => {
  const s = props.subject;
  if (!s) return "";
  return s.nameCn || s.name;
});
const subName = computed(() => {
  const s = props.subject;
  if (!s) return "";
  return s.nameCn && s.nameCn !== s.name ? s.name : "";
});
const metaParts = computed(() => {
  const s = props.subject;
  if (!s) return [] as string[];
  const parts: string[] = [];
  if (typeof s.rating === "number" && s.rating > 0) {
    parts.push(`★ ${s.rating.toFixed(2)}`);
    if (typeof s.votes === "number" && s.votes > 0) {
      parts.push(`${t("anime.votes")} ${s.votes.toLocaleString()}`);
    }
  }
  if (typeof s.rank === "number" && s.rank > 0) {
    parts.push(`${t("anime.rank")} #${s.rank}`);
  }
  if (s.airDate) parts.push(s.airDate);
  if (s.platform) parts.push(s.platform);
  if (typeof s.eps === "number" && s.eps > 0) {
    parts.push(`${t("anime.totalEpisodes")} ${s.eps}`);
  }
  return parts;
});
</script>

<template>
  <div class="anime-info">
    <div class="head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </button>
    </div>

    <div v-if="loading && !subject" class="state">{{ t("anime.loading") }}</div>
    <p v-else-if="error && !subject" class="state error">{{ error }}</p>

    <template v-else-if="subject">
      <div class="hero">
        <div ref="coverEl" class="cover">
          <img
            v-if="subject.images?.large"
            :src="subject.images.large"
            :alt="title"
            referrerpolicy="no-referrer"
          />
          <span v-else class="material-symbols-outlined">movie</span>
        </div>
        <div class="info">
          <h2 class="title">{{ title }}</h2>
          <p v-if="subName" class="sub-name">{{ subName }}</p>
          <div class="meta">
            <span v-for="(part, i) in metaParts" :key="i" class="meta-chip">{{ part }}</span>
          </div>
          <div v-if="subject.tags?.length" class="tags">
            <span v-for="(tag, i) in subject.tags.slice(0, 8)" :key="i" class="tag">{{ tag }}</span>
          </div>
        </div>
      </div>

      <section class="block">
        <h3 class="block-title">{{ t("anime.summary") }}</h3>
        <p v-if="subject.summary" class="summary">{{ subject.summary }}</p>
        <p v-else class="summary muted">{{ t("anime.noSummary") }}</p>
      </section>

      <section v-if="subject.alias?.length" class="block">
        <h3 class="block-title">{{ t("anime.alias") }}</h3>
        <div class="alias-row">
          <span v-for="(a, i) in subject.alias" :key="i" class="alias">{{ a }}</span>
        </div>
      </section>

      <!-- 追番：同步 Bangumi 收藏状态（未连接时引导去「我的追番」授权） -->
      <section class="block">
        <h3 class="block-title">
          <span class="material-symbols-outlined">subscriptions</span>
          {{ t("anime.myCollection") }}
        </h3>
        <template v-if="collect.authorized">
          <div class="status-row">
            <button
              v-for="s in STATUS_BTNS"
              :key="s.cat"
              class="status-chip"
              :class="{ active: currentStatus === s.cat }"
              :disabled="saving"
              @click="pickStatus(s.cat)"
            >
              <span v-if="saving && currentStatus === s.cat" class="material-symbols-outlined spin"
                >progress_activity</span
              >
              <span v-else class="material-symbols-outlined">{{ s.icon }}</span>
              {{ t("anime.cat" + s.cat) }}
            </button>
          </div>
          <p class="collect-hint">
            {{
              currentStatus === 0
                ? t("anime.collectNone")
                : t("anime.collectCurrent").replace("{s}", t("anime.cat" + currentStatus))
            }}
            <span v-if="collect.listError" class="collect-error">{{ collect.listError }}</span>
          </p>
        </template>
        <p v-else class="collect-hint">
          {{ t("anime.collectNeedAuth") }}
          <button class="link-btn" @click="emit('openCollection')">
            {{ t("anime.goConnect") }}
          </button>
        </p>
      </section>

      <div class="cta">
        <button class="lm-btn lm-btn--filled start-btn" @click="emit('openSources')">
          <span class="material-symbols-outlined">play_arrow</span>
          {{ t("anime.startWatch") }}
        </button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.anime-info {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: lm-rise 320ms var(--md-sys-motion-spring-spatial) both;
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
  gap: 18px;
  align-items: flex-start;
}
.cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 132px;
  aspect-ratio: 3 / 4;
  border-radius: var(--lm-shape-card);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-outline);
  box-shadow:
    inset 0 0 0 1px var(--lm-hairline),
    var(--md-elevation-1);
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
  margin: 0 0 4px;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
}
.sub-name {
  margin: 0 0 10px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.meta-chip {
  padding: 3px 9px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-size: var(--md-sys-typescale-label-small-size);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
.tag {
  padding: 3px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  border: 1px solid var(--md-sys-color-outline-variant);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.block-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 500;
}
.summary {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.7;
  color: var(--md-sys-color-on-surface);
  white-space: pre-wrap;
}
.summary.muted {
  color: var(--md-sys-color-on-surface-variant);
}
.alias-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.alias {
  padding: 3px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.cta {
  display: flex;
  justify-content: center;
  padding: 4px 0 24px;
}
.start-btn {
  min-width: 180px;
}
/* 追番状态按钮：MD3 suggestion chip，选中态走 primary 容器层 */
.status-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.status-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast),
    color var(--md-sys-motion-duration-short),
    border-color var(--md-sys-motion-duration-short);
}
.status-chip:hover:not(:disabled):not(.active) {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}
.status-chip.active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
  border-color: transparent;
}
.status-chip:disabled {
  opacity: 0.5;
  cursor: default;
}
.status-chip .material-symbols-outlined {
  font-size: 16px;
}
.status-chip .spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
.collect-hint {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.collect-error {
  color: var(--md-sys-color-error);
}
.link-btn {
  border: none;
  background: transparent;
  color: var(--md-sys-color-primary);
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
</style>
