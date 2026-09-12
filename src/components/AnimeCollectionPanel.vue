<script setup lang="ts">
/**
 * 我的追番（Bangumi 收藏列表）。
 *
 * 未连接：展示授权卡片（粘贴 Bangumi 官方 Access Token，指引页
 * https://next.bgm.tv/demo/access-token，Kazumi 同款方案）。
 * 已连接：按想看/看过/在看/搁置/抛弃分类展示 Bangumi 收藏，点卡片进详情；
 * 首次授权会自动做一次全量同步（逻辑在 stores/bangumiCollect）。
 */
import { computed, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useBangumiCollectStore } from "@/stores/bangumiCollect";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import AnimeCard from "@/components/AnimeCard.vue";
import type { BangumiCollectionCategory, BangumiSubject } from "@shared/types";

const emit = defineEmits<{
  (e: "back"): void;
  (e: "open", subject: BangumiSubject, ev?: MouseEvent): void;
}>();

const settings = useSettingsStore();
const collect = useBangumiCollectStore();
const t = (key: string) => translate(settings.lang, key);

const tokenDraft = ref(settings.bangumiToken);
const connecting = computed(() => collect.authState === "checking");

type TabKey = BangumiCollectionCategory | 6;
/** 6 = 全部（本地哨兵，不属于 Bangumi 类别） */
const TABS: { key: TabKey; icon: string }[] = [
  { key: 6, icon: "library_books" },
  { key: 3, icon: "play_circle" },
  { key: 1, icon: "bookmark" },
  { key: 2, icon: "done_all" },
  { key: 4, icon: "pause_circle" },
  { key: 5, icon: "do_not_disturb_on" },
];
const tab = ref<TabKey>(6);

const tabLabel = (key: TabKey) => (key === 6 ? t("anime.catAll") : t(`anime.cat${key}`));

const counts = computed(() => {
  const c: Record<TabKey, number> = {
    0: 0,
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: 0,
    6: collect.collections.length,
  };
  for (const item of collect.collections) c[item.category] = (c[item.category] ?? 0) + 1;
  return c;
});

const visible = computed(() =>
  tab.value === 6
    ? collect.collections
    : collect.collections.filter((c) => c.category === tab.value),
);

const syncedLabel = computed(() => {
  if (!collect.lastSyncAt) return t("anime.neverSynced");
  const d = new Date(collect.lastSyncAt);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${t("anime.lastSynced")} ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
});

function toCard(subject: BangumiSubject) {
  return {
    src: String(subject.id),
    title: subject.nameCn || subject.name,
    cover: subject.images?.large,
  };
}

function cardSubtitle(category: BangumiCollectionCategory, ep?: { collected?: number }): string {
  const parts = [tabLabel(category)];
  if (ep && typeof ep.collected === "number" && ep.collected > 0) {
    parts.push(t("anime.epWatched").replace("{n}", String(ep.collected)));
  }
  return parts.join(" · ");
}

async function connect() {
  await collect.connect(tokenDraft.value);
}

async function openTokenPage() {
  try {
    await capabilities.openUrl("https://next.bgm.tv/demo/access-token");
  } catch {
    /* 打不开浏览器时用户可手动访问 */
  }
}

async function disconnect() {
  collect.disconnect();
  tokenDraft.value = "";
}
</script>

<template>
  <div class="bangumi-collect">
    <div class="head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </button>
      <h2 class="page-title">
        <span class="material-symbols-outlined">subscriptions</span>
        {{ t("anime.myCollection") }}
      </h2>
      <button
        v-if="collect.authorized"
        class="lm-btn lm-btn--tonal"
        :disabled="collect.listLoading"
        @click="collect.pull()"
      >
        <span class="material-symbols-outlined" :class="{ spin: collect.listLoading }">sync</span>
        {{
          collect.listLoading && collect.syncProgress ? collect.syncProgress : t("anime.syncNow")
        }}
      </button>
    </div>

    <!-- 未连接：授权卡片（有离线缓存时仍可先逛列表） -->
    <section v-if="!collect.authorized" class="auth-card">
      <h3 class="auth-title">
        <span class="material-symbols-outlined">link</span>
        {{ t("anime.bangumiConnect") }}
      </h3>
      <p class="auth-hint">
        {{ t("anime.bangumiTokenHint") }}
        <button class="link-btn" @click="openTokenPage">
          {{ t("anime.bangumiTokenGuide") }}
        </button>
        {{ t("anime.bangumiTokenSuffix") }}
      </p>
      <div class="token-row">
        <input
          v-model="tokenDraft"
          type="password"
          spellcheck="false"
          autocomplete="off"
          :placeholder="t('anime.bangumiTokenPlaceholder')"
          @keyup.enter="connect"
        />
        <button
          class="lm-btn lm-btn--filled"
          :disabled="connecting || !tokenDraft.trim()"
          @click="connect"
        >
          <span v-if="connecting" class="material-symbols-outlined spin">progress_activity</span>
          <span v-else class="material-symbols-outlined">login</span>
          {{ t("anime.bangumiConnectBtn") }}
        </button>
      </div>
      <p v-if="collect.authError" class="auth-error">{{ collect.authError }}</p>
      <p v-else-if="collect.authState === 'checking'" class="auth-pending">
        {{ t("anime.bangumiConnecting") }}
      </p>
    </section>

    <p v-if="collect.listError" class="sync-error">{{ collect.listError }}</p>

    <!-- 已连接：账号行 + 分类页签 -->
    <template v-if="collect.authorized || collect.collections.length">
      <div class="account-row">
        <span class="who">
          <span class="material-symbols-outlined">account_circle</span>
          {{ collect.user?.nickname || settings.bangumiUsername || t("anime.offlineCache") }}
        </span>
        <span class="sync-at">{{ collect.listLoading ? collect.syncProgress : syncedLabel }}</span>
        <button v-if="collect.authorized" class="lm-btn lm-btn--text" @click="disconnect">
          {{ t("anime.bangumiDisconnect") }}
        </button>
      </div>

      <div class="tabs">
        <button
          v-for="tabItem in TABS"
          :key="tabItem.key"
          class="tab"
          :class="{ active: tab === tabItem.key }"
          @click="tab = tabItem.key"
        >
          <span class="material-symbols-outlined">{{ tabItem.icon }}</span>
          {{ tabLabel(tabItem.key) }}
          <span class="cnt">{{ counts[tabItem.key] ?? 0 }}</span>
        </button>
      </div>

      <div v-if="visible.length" class="anime-grid">
        <AnimeCard
          v-for="c in visible"
          :key="c.subjectId"
          :item="toCard(c.subject)"
          :subtitle="cardSubtitle(c.category, c.epStatus)"
          @open="emit('open', c.subject, $event)"
        />
      </div>
      <div v-else-if="collect.listLoading" class="state">{{ t("anime.loading") }}</div>
      <div v-else class="state">{{ t("anime.collectionEmpty") }}</div>
    </template>
  </div>
</template>

<style scoped>
.bangumi-collect {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
}
.head {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.page-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 500;
  flex: 1;
  min-width: 0;
}
.page-title .material-symbols-outlined {
  font-size: 24px;
  color: var(--md-sys-color-primary);
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
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}

/* 授权卡片：三阶取色——容器层用 tertiary 家族与主列表区分 */
.auth-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-tertiary-container);
  color: var(--md-sys-color-on-tertiary-container);
}
.auth-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.auth-hint {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
  opacity: 0.92;
}
.link-btn {
  border: none;
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
.token-row {
  display: flex;
  gap: 8px;
}
.token-row input {
  flex: 1;
  min-width: 0;
  height: 40px;
  padding: 0 14px;
  border: 1px solid transparent;
  border-radius: var(--md-sys-shape-corner-extra-large);
  background: var(--md-sys-color-surface-container-lowest);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
}
.token-row input:focus {
  border-color: var(--md-sys-color-tertiary);
}
.token-row .material-symbols-outlined {
  font-size: 18px;
}
.auth-error {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-error);
}
.auth-pending {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  opacity: 0.8;
}
.sync-error {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-error);
}

.account-row {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 500;
  color: var(--md-sys-color-on-surface);
}
.who .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-secondary);
}
.sync-at {
  flex: 1;
  min-width: 0;
}

.tabs {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  padding: 3px;
  width: fit-content;
  border-radius: var(--md-sys-shape-corner-full);
  background: var(--md-sys-color-surface-container);
}
.tab {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 14px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.tab .material-symbols-outlined {
  font-size: 16px;
}
.tab:hover {
  background: var(--md-sys-color-surface-container-high);
}
.tab.active {
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.cnt {
  font-size: var(--md-sys-typescale-label-small-size);
  opacity: 0.8;
}

.anime-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
  gap: 16px;
}
.state {
  padding: 24px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
</style>
