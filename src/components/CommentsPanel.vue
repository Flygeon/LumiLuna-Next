<script setup lang="ts">
/**
 * 网易云歌曲评论面板（MD3）。
 * 参考参考项目 comment-sheet 的「精彩评论 / 最新评论」信息流排列。
 */
import { ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { NeteaseComment, NeteaseCommentsPage } from "@shared/types";

const props = withDefaults(
  defineProps<{
    open: boolean;
    songId: number | null;
    title?: string;
    artist?: string;
  }>(),
  {
    title: "",
    artist: "",
  },
);

const emit = defineEmits<{ (e: "close"): void }>();

const settings = useSettingsStore();

const PAGE_SIZE = 20;
const status = ref<"idle" | "loading" | "ready" | "error">("idle");
const comments = ref<NeteaseComment[]>([]);
const hotComments = ref<NeteaseComment[]>([]);
const total = ref(0);
const hasMore = ref(false);
const loadingMore = ref(false);
const offset = ref(0);

function t(key: string) {
  return translate(settings.lang, key);
}

function formatCount(value: number): string {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`;
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)}万`;
  return String(value);
}

function formatCommentTime(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 86_400_000;
  if (diff < minute) return "刚刚";
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`;
  const date = new Date(ms);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function parseComments(data: NeteaseCommentsPage) {
  comments.value = data.comments;
  hotComments.value = data.hotComments;
  total.value = data.total;
  hasMore.value = data.more && data.comments.length > 0;
}

watch(
  () => [props.open, props.songId] as const,
  async ([open, songId]) => {
    if (!open || !songId) return;
    status.value = "loading";
    comments.value = [];
    hotComments.value = [];
    total.value = 0;
    hasMore.value = false;
    offset.value = 0;
    try {
      const data = await capabilities.neteaseSongComments(songId, 0, PAGE_SIZE);
      parseComments(data);
      status.value = "ready";
    } catch {
      status.value = "error";
    }
  },
  { immediate: true },
);

async function loadMore() {
  if (!props.songId || loadingMore.value || !hasMore.value) return;
  loadingMore.value = true;
  try {
    const nextOffset = offset.value + PAGE_SIZE;
    const data = await capabilities.neteaseSongComments(props.songId, nextOffset, PAGE_SIZE);
    offset.value = nextOffset;
    const seen = new Set(comments.value.map((c) => c.commentId));
    const merged = data.comments.filter((c) => !seen.has(c.commentId));
    comments.value = [...comments.value, ...merged];
    hasMore.value = data.more && data.comments.length > 0;
  } catch {
    // 保持现状，可再次点击
  } finally {
    loadingMore.value = false;
  }
}

function nicknameOf(c: NeteaseComment): string {
  return c.user?.nickname?.trim() || "网易云用户";
}
</script>

<template>
  <Teleport to="body">
    <Transition name="comment-fade">
      <div v-if="open" class="comment-overlay" @click.self="emit('close')">
        <div class="comment-panel">
          <div class="comment-head">
            <div class="comment-title-row">
              <h3 class="comment-title">{{ t("netease.comments") }}</h3>
              <button class="comment-close" @click="emit('close')">
                <span class="material-symbols-outlined">close</span>
              </button>
            </div>
            <p v-if="title" class="comment-track">{{ title }}<span v-if="artist"> · {{ artist }}</span></p>
            <div v-if="status === 'ready'" class="comment-stats">
              <span v-if="total > 0">{{ t("netease.commentCount") }} {{ formatCount(total) }}</span>
            </div>
          </div>

          <div class="comment-body">
            <p v-if="status === 'loading'" class="comment-state">{{ t("netease.commentsLoading") }}</p>
            <p v-else-if="status === 'error'" class="comment-state error">{{ t("netease.commentsError") }}</p>
            <template v-else-if="hotComments.length || comments.length">
              <section v-if="hotComments.length" class="comment-section">
                <h4 class="comment-section-title">{{ t("netease.hotComments") }}</h4>
                <article
                  v-for="c in hotComments"
                  :key="c.commentId"
                  class="comment-item"
                >
                  <img
                    v-if="c.user?.avatarUrl"
                    :src="c.user.avatarUrl"
                    alt=""
                    class="comment-avatar"
                    loading="lazy"
                  />
                  <span v-else class="comment-avatar placeholder" />
                  <div class="comment-content">
                    <div class="comment-meta">
                      <span class="comment-nick hot">{{ nicknameOf(c) }}</span>
                      <span class="comment-time">{{ formatCommentTime(c.time) }}</span>
                    </div>
                    <p v-if="c.beReplied?.[0]" class="comment-reply">
                      <span class="reply-nick">@{{ c.beReplied[0].user?.nickname || "用户" }}</span>
                      ：{{ c.beReplied[0].content }}
                    </p>
                    <p class="comment-text">{{ c.content }}</p>
                    <div v-if="c.likedCount > 0 || c.ipLocation?.location" class="comment-footer">
                      <span v-if="c.ipLocation?.location">{{ c.ipLocation.location }}</span>
                      <span v-if="c.likedCount > 0" class="comment-like">
                        <span class="material-symbols-outlined">favorite</span>
                        {{ formatCount(c.likedCount) }}
                      </span>
                    </div>
                  </div>
                </article>
              </section>

              <section v-if="comments.length" class="comment-section">
                <h4 v-if="hotComments.length" class="comment-section-title">{{ t("netease.latestComments") }}</h4>
                <article
                  v-for="c in comments"
                  :key="c.commentId"
                  class="comment-item"
                >
                  <img
                    v-if="c.user?.avatarUrl"
                    :src="c.user.avatarUrl"
                    alt=""
                    class="comment-avatar"
                    loading="lazy"
                  />
                  <span v-else class="comment-avatar placeholder" />
                  <div class="comment-content">
                    <div class="comment-meta">
                      <span class="comment-nick">{{ nicknameOf(c) }}</span>
                      <span class="comment-time">{{ formatCommentTime(c.time) }}</span>
                    </div>
                    <p v-if="c.beReplied?.[0]" class="comment-reply">
                      <span class="reply-nick">@{{ c.beReplied[0].user?.nickname || "用户" }}</span>
                      ：{{ c.beReplied[0].content }}
                    </p>
                    <p class="comment-text">{{ c.content }}</p>
                    <div v-if="c.likedCount > 0 || c.ipLocation?.location" class="comment-footer">
                      <span v-if="c.ipLocation?.location">{{ c.ipLocation.location }}</span>
                      <span v-if="c.likedCount > 0" class="comment-like">
                        <span class="material-symbols-outlined">favorite</span>
                        {{ formatCount(c.likedCount) }}
                      </span>
                    </div>
                  </div>
                </article>
              </section>
            </template>
            <p v-else class="comment-state">{{ t("netease.commentsEmpty") }}</p>
          </div>

          <button
            v-if="hasMore"
            class="comment-more"
            :disabled="loadingMore"
            @click="loadMore"
          >
            {{ loadingMore ? t("netease.commentsLoadingMore") : t("netease.commentsLoadMore") }}
          </button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.comment-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(3px);
}
.comment-panel {
  display: flex;
  flex-direction: column;
  width: min(460px, 100vw);
  height: 100%;
  max-height: 100vh;
  padding: 20px 24px 16px;
  background: var(--md-sys-color-surface-container-high);
  box-shadow: var(--md-elevation-3);
  overflow: hidden;
}
/* 移动端满屏抽屉：顶部会被状态栏压住、底部被手势条遮住，让出安全区。
   :global 是因为 .is-mobile 挂在 <html> 上，不在本组件 scope 内。 */
:global(html.is-mobile .comment-panel) {
  padding: calc(16px + var(--lm-safe-top)) 16px calc(12px + var(--lm-safe-bottom));
}

/* 从左侧滑入：遮罩淡入 + 面板滑动；关闭时反向播放同一动画 */
.comment-fade-enter-active,
.comment-fade-leave-active {
  transition: opacity 320ms var(--md-sys-motion-easing-standard);
}
.comment-fade-enter-from,
.comment-fade-leave-to {
  opacity: 0;
}
.comment-fade-enter-active .comment-panel,
.comment-fade-leave-active .comment-panel {
  transition: transform 320ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.comment-fade-enter-from .comment-panel,
.comment-fade-leave-to .comment-panel {
  transform: translateX(-100%);
}
.comment-head {
  flex: none;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--lm-hairline);
}
.comment-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.comment-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.comment-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
}
.comment-close:hover {
  background: var(--md-sys-color-surface-container-highest);
}
.comment-track {
  margin: 6px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.comment-stats {
  margin-top: 6px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.comment-body {
  flex: 1;
  overflow-y: auto;
  padding: 12px 4px 8px 0;
}
.comment-state {
  padding: 32px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.comment-state.error {
  color: var(--md-sys-color-error);
}
.comment-section {
  margin-bottom: 18px;
}
.comment-section-title {
  margin: 0 0 12px;
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
}
.comment-item {
  display: flex;
  gap: 12px;
  padding: 10px 0;
}
.comment-avatar {
  flex: none;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  object-fit: cover;
  background: var(--md-sys-color-surface-container);
}
.comment-avatar.placeholder {
  display: block;
}
.comment-content {
  min-width: 0;
  flex: 1;
}
.comment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comment-nick {
  font-size: var(--md-sys-typescale-body-small-size);
  font-weight: 600;
  color: var(--md-sys-color-on-surface);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.comment-nick.hot {
  color: var(--md-sys-color-primary);
}
.comment-time {
  flex: none;
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.comment-reply {
  margin: 6px 0 0;
  padding: 6px 10px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.reply-nick {
  font-weight: 600;
}
.comment-text {
  margin: 6px 0 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface);
  white-space: pre-wrap;
  word-break: break-word;
}
.comment-footer {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 4px;
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.comment-like {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.comment-like .material-symbols-outlined {
  font-size: 14px;
}
.comment-more {
  flex: none;
  height: 40px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  font-weight: 500;
  cursor: pointer;
}
.comment-more:disabled {
  opacity: 0.5;
}
.comment-more:hover:not(:disabled) {
  background: var(--md-sys-color-surface-container-highest);
}
</style>