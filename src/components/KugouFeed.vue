<script setup lang="ts">
/**
 * 酷狗「为你推荐」信息流：每日推荐 + 每日签到（签到日历）。
 *
 * 与网易云的 `NowPlayingFeed` 并列存在（一平台一组件），而不是让同一个组件
 * 吃 `server` 参数——两家的推荐结构本就不同（网易云是私人 FM / 每日推荐 /
 * 推荐歌单；酷狗是每日推荐 / 签到 / 排行榜），硬塞进一张能力表反而拧巴。
 * 这与 `BooksView.vue` 里 `NovelOnlineView` / `NovelBqgView` 的既有做法一致。
 */
import { computed, onMounted, ref } from "vue";
import { capabilities } from "@/capabilities";
import { useKugouStore } from "@/stores/kugou";
import { useSettingsStore } from "@/stores/settings";
import { kugouToOnlineSongs } from "@/utils/kugou";
import { translate } from "@shared/i18n";
import type { OnlineSong } from "@shared/types";

const emit = defineEmits<{ (e: "play-songs", songs: OnlineSong[], index: number): void }>();

const settings = useSettingsStore();
const kugou = useKugouStore();

function t(key: string) {
  return translate(settings.lang, key);
}

// ---- 每日推荐 ----

const status = ref<"loading" | "ready" | "error">("loading");
const error = ref("");
const dailySongs = ref<OnlineSong[]>([]);
const dailyLoading = ref(false);

async function loadDaily() {
  status.value = "loading";
  error.value = "";
  try {
    const raw = await capabilities.kugouEverydayRecommend();
    dailySongs.value = kugouToOnlineSongs(raw);
    status.value = "ready";
  } catch (e) {
    status.value = "error";
    error.value = e instanceof Error ? e.message : String(e);
  }
}

async function playDaily() {
  if (dailyLoading.value || !dailySongs.value.length) return;
  dailyLoading.value = true;
  try {
    emit("play-songs", dailySongs.value, 0);
  } finally {
    dailyLoading.value = false;
  }
}

const dailySubtitle = computed(() =>
  dailySongs.value.length ? t("homeFeed.dailyHint") : t("homeFeed.empty"),
);

// ---- 签到日历 ----

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 当月每一天及签到状态（本地日期与 Rust 侧口径一致） */
const monthDays = computed(() => {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const total = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: total }, (_, i) => {
    const day = i + 1;
    const key = `${year}-${pad2(month + 1)}-${pad2(day)}`;
    return { day, key, signed: kugou.signedDays.includes(key) };
  });
});

const monthLabel = computed(() => {
  const now = new Date();
  return `${now.getFullYear()} / ${pad2(now.getMonth() + 1)}`;
});

const signedCount = computed(() => monthDays.value.filter((d) => d.signed).length);

onMounted(loadDaily);
</script>

<template>
  <div class="kg-feed">
    <div v-if="status === 'loading'" class="feed-hint">
      <m3e-loading-indicator class="lm-loading" />
      {{ t("online.loading") }}
    </div>
    <p v-else-if="status === 'error'" class="feed-error">
      <span class="material-symbols-outlined">error</span>
      {{ error }}
      <m3e-button variant="text" size="small" @click="loadDaily">
        {{ t("actions.retry") }}
      </m3e-button>
    </p>

    <template v-else>
      <!-- 每日推荐 -->
      <section class="feed-section">
        <button class="feed-hero" :disabled="!dailySongs.length" @click="playDaily">
          <span class="hero-icon material-symbols-outlined">event_available</span>
          <div class="hero-main">
            <h3 class="hero-title">{{ t("homeFeed.dailyRecommend") }}</h3>
            <p class="hero-desc">{{ dailySubtitle }}</p>
          </div>
          <span
            class="hero-play material-symbols-outlined"
            :class="{ spinning: dailyLoading }"
            aria-hidden="true"
            >play_arrow</span
          >
        </button>
      </section>

      <!-- 每日签到 -->
      <section class="feed-section">
        <div class="feed-section-head">
          <h3 class="feed-section-title">{{ t("kugou.signIn") }}</h3>
          <span class="feed-section-sub">{{ t("kugou.signInHint") }}</span>
        </div>

        <div class="sign-card">
          <div class="sign-head">
            <span class="sign-month tabular-nums">{{ monthLabel }}</span>
            <span v-if="kugou.loggedIn" class="sign-count tabular-nums">
              {{ signedCount }} / {{ monthDays.length }}
            </span>
            <m3e-button
              v-if="kugou.loggedIn"
              :variant="kugou.signedToday ? 'text' : 'tonal'"
              size="small"
              :disabled="kugou.signing"
              @click="kugou.signIn()"
            >
              <span slot="icon" class="material-symbols-outlined">task_alt</span>
              {{ kugou.signedToday ? t("kugou.signedToday") : t("kugou.signIn") }}
            </m3e-button>
          </div>

          <p v-if="!kugou.loggedIn" class="sign-hint">
            {{ t("kugou.loginHint") }}
          </p>
          <template v-else>
            <div class="sign-grid">
              <span
                v-for="d in monthDays"
                :key="d.key"
                class="sign-day tabular-nums"
                :class="{ signed: d.signed }"
                :title="d.key"
                >{{ d.day }}</span
              >
            </div>
            <p v-if="kugou.signInMessage" class="sign-msg" :class="{ error: kugou.needVerify }">
              {{ kugou.signInMessage }}
            </p>
          </template>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.kg-feed {
  display: flex;
  flex-direction: column;
  gap: 24px;
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
}

.feed-hint,
.feed-error {
  padding: 40px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.feed-error {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--md-sys-color-error);
}
.feed-error .material-symbols-outlined {
  font-size: 20px;
}

.feed-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.feed-hero {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 220ms var(--md-sys-motion-spring-spatial-fast),
    box-shadow 180ms;
}
.feed-hero:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: var(--md-elevation-2);
}
.feed-hero:disabled {
  opacity: 0.6;
  cursor: default;
}
.hero-icon {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  font-size: 26px;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.hero-main {
  flex: 1;
  min-width: 0;
}
.hero-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.hero-desc {
  margin: 4px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.hero-play {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  font-size: 22px;
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.hero-play.spinning {
  animation: lm-spin 1s linear infinite;
}

.feed-section-head {
  display: flex;
  align-items: baseline;
  gap: 10px;
  flex-wrap: wrap;
}
.feed-section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.feed-section-sub {
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

.sign-card {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 16px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.sign-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.sign-month {
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 500;
}
.sign-count {
  flex: 1;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.sign-hint,
.sign-msg {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.sign-msg.error {
  color: var(--md-sys-color-error);
}
.sign-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(26px, 1fr));
  gap: 4px;
}
.sign-day {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  border-radius: var(--md-sys-shape-corner-small);
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container);
}
.sign-day.signed {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
  font-weight: 500;
}
</style>
