// 移植自 Pixez（GPL-3.0），本仓库 GPL-3.0-only，兼容。
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { usePixivStore } from "@/stores/pixiv";
import { translate } from "@shared/i18n";
import type { PixivIllust } from "@shared/types";
import PixivCard from "@/components/PixivCard.vue";

const props = defineProps<{
  illust: PixivIllust;
  related: PixivIllust[];
  loading?: boolean;
  error?: string;
}>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "open-related", id: number): void;
  (e: "open-user", id: number): void;
}>();

const settings = useSettingsStore();
const pixiv = usePixivStore();
const src = ref("");

const t = (key: string) => translate(settings.lang, key);

const detailUrl = computed(
  () =>
    props.illust.imageUrls.large ?? props.illust.imageUrls.original ?? pixiv.coverUrl(props.illust),
);

const tagList = computed(() => props.illust.tags.map((tg) => tg.translatedName || tg.name));
const dateText = computed(() => (props.illust.createDate || "").replace("T", " ").slice(0, 16));

onMounted(async () => {
  try {
    src.value = await pixiv.imageUrl(detailUrl.value);
  } catch {
    src.value = "";
  }
  // 评论（面板以 illust.id 为 key 强制重建，onMounted 拉取即可）
  void pixiv.fetchComments(props.illust.id);
  // ugoira 动图：拉帧并循环播放
  if (props.illust.type === "ugoira") void loadUgoira();
});

function openRelated(ill: PixivIllust) {
  emit("open-related", ill.id);
}

function openUser() {
  emit("open-user", props.illust.user.id);
}

async function toggleBookmark() {
  await pixiv.toggleBookmark(props.illust.id);
}

// ---- ugoira 动图 ----

const ugoiraFrames = ref<{ src: string; delay: number }[]>([]);
const frameIdx = ref(0);
let ugoiraTimer: number | undefined;

async function loadUgoira() {
  try {
    const fr = await pixiv.fetchUgoira(props.illust.id);
    if (!fr.length) return;
    ugoiraFrames.value = fr;
    startUgoira();
  } catch {
    /* 拉帧失败回退静态封面 */
  }
}

function startUgoira() {
  stopUgoira();
  let i = 0;
  const step = () => {
    frameIdx.value = i;
    const d = ugoiraFrames.value[i]?.delay ?? 50;
    i = (i + 1) % ugoiraFrames.value.length;
    ugoiraTimer = window.setTimeout(step, d);
  };
  step();
}

function stopUgoira() {
  if (ugoiraTimer !== undefined) {
    window.clearTimeout(ugoiraTimer);
    ugoiraTimer = undefined;
  }
}
onUnmounted(stopUgoira);

function fmtDate(s?: string | null): string {
  return (s || "").replace("T", " ").slice(0, 16);
}

// ---- 大图预览（Lightbox） ----

/** 可预览的页面原图列表：多页作品取 metaPages，单页取 original/large */
const pages = computed<string[]>(() => {
  const ill = props.illust;
  if (ill.metaPages?.length) {
    return ill.metaPages
      .map((p) => p.imageUrls.original ?? p.imageUrls.large ?? p.imageUrls.medium ?? "")
      .filter(Boolean);
  }
  const u = ill.imageUrls.original ?? ill.imageUrls.large ?? pixiv.coverUrl(ill);
  return u ? [u] : [];
});

const preview = ref({ open: false, index: 0 });
const previewSrc = ref("");
let previewSeq = 0;

function openPreview(index: number) {
  if (!pages.value.length) return;
  preview.value = { open: true, index };
}

function closePreview() {
  preview.value = { open: false, index: 0 };
  previewSrc.value = "";
}

function stepPreview(delta: number) {
  const n = pages.value.length;
  if (!n) return;
  preview.value.index = (preview.value.index + delta + n) % n;
}

watch(
  () => [preview.value.open, preview.value.index] as const,
  async ([open, index]) => {
    if (!open) return;
    const url = pages.value[index];
    if (!url) return;
    const seq = ++previewSeq;
    previewSrc.value = "";
    try {
      const s = await pixiv.imageUrl(url);
      if (seq === previewSeq) previewSrc.value = s;
    } catch {
      /* 预览加载失败留白即可 */
    }
  },
);

function onKeydown(e: KeyboardEvent) {
  if (!preview.value.open) return;
  if (e.key === "Escape") closePreview();
  else if (e.key === "ArrowRight") stepPreview(1);
  else if (e.key === "ArrowLeft") stepPreview(-1);
}
onMounted(() => window.addEventListener("keydown", onKeydown));
onUnmounted(() => window.removeEventListener("keydown", onKeydown));
</script>

<template>
  <div class="pixiv-detail">
    <div class="search-head">
      <m3e-button variant="text" class="back" @click="emit('back')">
        <span slot="icon" class="material-symbols-outlined">arrow_back</span>
        {{ t("pixiv.back") }}
      </m3e-button>
      <h2 class="page-title">{{ illust.title }}</h2>
    </div>

    <div v-if="loading" class="state">{{ t("pixiv.loading") }}</div>
    <div v-else-if="error" class="state list-error">{{ error }}</div>

    <div v-else class="detail-body">
      <div class="cover-wrap">
        <!-- ugoira 动图：帧动画 -->
        <img
          v-if="ugoiraFrames.length"
          :src="ugoiraFrames[frameIdx]?.src"
          :alt="illust.title"
          class="cover-img"
        />
        <img
          v-else-if="src"
          :src="src"
          :alt="illust.title"
          class="cover-img"
          title="点击预览大图"
          @click="openPreview(0)"
        />
        <span v-else class="material-symbols-outlined placeholder">image</span>
        <span v-if="illust.type === 'ugoira'" class="page-badge">GIF</span>
        <span v-else-if="illust.pageCount > 1" class="page-badge">
          {{ illust.pageCount }} {{ t("pixiv.pages") }}
        </span>
      </div>

      <div class="info">
        <button class="author-row author-link" :title="illust.user.name" @click="openUser">
          <span class="material-symbols-outlined">person</span>
          <span>{{ illust.user.name }}</span>
          <span class="material-symbols-outlined chev">chevron_right</span>
        </button>

        <div class="stats">
          <span class="chip-static">
            <span class="material-symbols-outlined">visibility</span>
            {{ illust.totalView }} {{ t("pixiv.totalViews") }}
          </span>
          <m3e-filter-chip
            class="bookmark-chip"
            :selected="pixiv.bookmarked"
            :title="t('pixiv.myBookmarks')"
            @click="toggleBookmark"
          >
            <span slot="icon" class="material-symbols-outlined">
              {{ pixiv.bookmarked ? "bookmark" : "bookmark_border" }}
            </span>
            {{ illust.totalBookmarks }} {{ t("pixiv.totalBookmarks") }}
          </m3e-filter-chip>
          <span v-if="dateText" class="chip-static">
            <span class="material-symbols-outlined">event</span>{{ dateText }}
          </span>
          <span v-if="illust.width" class="chip-static">
            {{ illust.width }}×{{ illust.height }}
          </span>
        </div>

        <div v-if="tagList.length" class="tags">
          <span v-for="tag in tagList" :key="tag" class="chip">{{ tag }}</span>
        </div>

        <p v-if="illust.caption" class="caption">{{ illust.caption }}</p>
      </div>
    </div>

    <!-- 评论 -->
    <section v-if="!loading && !error" class="section">
      <h3 class="section-title">
        <span class="material-symbols-outlined">forum</span>
        {{ t("pixiv.comments") }}
        <span v-if="pixiv.comments.length" class="count">{{ pixiv.comments.length }}</span>
      </h3>

      <div v-if="pixiv.commentsLoading && !pixiv.comments.length" class="state">
        {{ t("pixiv.loading") }}
      </div>
      <div v-else-if="pixiv.commentsError && !pixiv.comments.length" class="state list-error">
        {{ pixiv.commentsError }}
        <m3e-button variant="text" @click="pixiv.fetchComments(illust.id)">
          <span slot="icon" class="material-symbols-outlined">refresh</span>{{ t("pixiv.retry") }}
        </m3e-button>
      </div>
      <div v-else-if="pixiv.comments.length" class="comments">
        <div v-for="c in pixiv.comments" :key="c.id" class="comment">
          <div v-if="c.parentComment" class="parent-quote">
            <span class="parent-author">{{ c.parentComment.user.name }}</span>
            <span class="comment-text">{{ c.parentComment.comment }}</span>
          </div>
          <div class="comment-head">
            <span class="comment-author">{{ c.user.name }}</span>
            <span v-if="fmtDate(c.date)" class="comment-date">{{ fmtDate(c.date) }}</span>
          </div>
          <div class="comment-text">{{ c.comment }}</div>
        </div>

        <div v-if="pixiv.commentsNext != null" class="load-more">
          <m3e-button
            variant="tonal"
            :disabled="pixiv.commentsLoading"
            @click="pixiv.fetchCommentsMore()"
          >
            <span v-if="pixiv.commentsLoading" slot="icon" class="material-symbols-outlined spin"
              >progress_activity</span
            >
            <span v-else slot="icon" class="material-symbols-outlined">expand_more</span>
            {{ t("pixiv.loadMore") }}
          </m3e-button>
        </div>
      </div>
      <div v-else class="state">{{ t("pixiv.empty") }}</div>
    </section>

    <!-- 相关作品 -->
    <section v-if="related.length" class="section">
      <h3 class="section-title">
        <span class="material-symbols-outlined">auto_awesome_motion</span>
        {{ t("pixiv.related") }}
      </h3>
      <div class="pixiv-grid">
        <PixivCard v-for="ill in related" :key="ill.id" :illust="ill" @open="openRelated(ill)" />
      </div>
    </section>

    <!-- 大图预览（Teleport 到 body，避免被父级 transform 影响） -->
    <Teleport to="body">
      <div v-if="preview.open" class="lightbox" @click.self="closePreview">
        <div class="lightbox-bar">
          <span v-if="pages.length > 1" class="lightbox-indicator">
            {{ preview.index + 1 }} / {{ pages.length }}
          </span>
          <m3e-icon-button
            variant="filled"
            class="lightbox-btn"
            :title="t('pixiv.back')"
            @click="closePreview"
          >
            <span class="material-symbols-outlined">close</span>
          </m3e-icon-button>
        </div>
        <img v-if="previewSrc" :src="previewSrc" class="lightbox-img" @click.self="closePreview" />
        <span v-else class="material-symbols-outlined lightbox-loading spin"
          >progress_activity</span
        >
        <template v-if="pages.length > 1">
          <m3e-icon-button
            variant="filled"
            class="lightbox-btn lightbox-nav lightbox-nav--prev"
            @click="stepPreview(-1)"
          >
            <span class="material-symbols-outlined">chevron_left</span>
          </m3e-icon-button>
          <m3e-icon-button
            variant="filled"
            class="lightbox-btn lightbox-nav lightbox-nav--next"
            @click="stepPreview(1)"
          >
            <span class="material-symbols-outlined">chevron_right</span>
          </m3e-icon-button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.pixiv-detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
}
.search-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.detail-body {
  display: grid;
  grid-template-columns: minmax(220px, 320px) 1fr;
  gap: 20px;
  align-items: start;
}
.cover-wrap {
  position: relative;
  border-radius: var(--lm-shape-card);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  box-shadow: var(--md-elevation-2);
  aspect-ratio: 3 / 4;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--md-sys-color-outline);
}
.cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
  transition: filter 160ms var(--md-sys-motion-spring-effects-fast);
}
.cover-img:hover {
  filter: brightness(1.08);
}
.cover-wrap .placeholder {
  font-size: 48px;
}
.page-badge {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: var(--md-sys-typescale-label-small-size);
  pointer-events: none;
}
.info {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.author-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.author-link {
  padding: 4px 8px;
  margin-left: -8px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: inherit;
  font-family: inherit;
  align-self: flex-start;
  cursor: pointer;
}
.author-link:hover {
  background: var(--md-sys-color-surface-container);
}
.author-link .chev {
  font-size: 16px;
  color: var(--md-sys-color-on-surface-variant);
}
.author-row .material-symbols-outlined {
  font-size: 20px;
  color: var(--md-sys-color-primary);
}
.stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.chip-static {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.chip-static .material-symbols-outlined {
  font-size: 15px;
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.tags .chip {
  height: 28px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.caption {
  margin: 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-line;
}
.section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.section-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.section-title .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.section-title .count {
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
  font-weight: 400;
}
.pixiv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 16px;
}

/* 评论 */
.comments {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.comment {
  padding: 10px 14px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
}
.comment-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 4px;
}
.comment-author {
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 500;
  color: var(--md-sys-color-primary);
}
.comment-date {
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.comment-text {
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface);
  white-space: pre-line;
  word-break: break-word;
}
.parent-quote {
  margin-bottom: 8px;
  padding: 6px 10px;
  border-left: 3px solid var(--md-sys-color-outline-variant);
  border-radius: 4px;
  background: var(--md-sys-color-surface-container-high);
}
.parent-author {
  display: block;
  font-size: var(--md-sys-typescale-label-small-size);
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
  margin-bottom: 2px;
}
.parent-quote .comment-text {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.load-more {
  display: flex;
  justify-content: center;
  padding: 4px 0;
}

/* 大图预览 Lightbox */
.lightbox {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.88);
  animation: lm-fade 160ms var(--md-sys-motion-spring-effects-fast) both;
}
.lightbox-img {
  max-width: 94vw;
  max-height: 90vh;
  object-fit: contain;
  border-radius: 4px;
  user-select: none;
}
.lightbox-bar {
  position: absolute;
  top: 0;
  right: 0;
  left: 0;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 16px;
}
.lightbox-indicator {
  position: absolute;
  left: 16px;
  color: rgba(255, 255, 255, 0.9);
  font-size: var(--md-sys-typescale-label-large-size);
  font-variant-numeric: tabular-nums;
}
/* 大图预览灯箱按钮：m3e-icon-button（filled），半透明白底白图标 */
.lightbox-btn {
  --m3e-filled-icon-button-container-color: rgba(255, 255, 255, 0.12);
  --m3e-filled-icon-button-icon-color: #fff;
  --m3e-filled-icon-button-hover-container-color: rgba(255, 255, 255, 0.22);
  --m3e-filled-icon-button-hover-icon-color: #fff;
  width: 40px;
  height: 40px;
}
.lightbox-loading {
  color: rgba(255, 255, 255, 0.8);
  font-size: 40px;
}
.lightbox-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
}
.lightbox-nav--prev {
  left: 16px;
}
.lightbox-nav--next {
  right: 16px;
}
@keyframes lm-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.list-error {
  color: var(--md-sys-color-error);
  white-space: pre-line;
  line-height: 1.6;
  max-width: 640px;
  margin-inline: auto;
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (max-width: 720px) {
  .detail-body {
    grid-template-columns: 1fr;
  }
}
</style>
