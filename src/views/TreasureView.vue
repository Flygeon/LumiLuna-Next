<script setup lang="ts">
import { useRouter } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const router = useRouter();

function t(key: string) {
  return translate(settings.lang, key);
}

// 收纳进百宝箱的模块（收藏 / 历史 / 回收站 / 扩展）。
// 标题与副文优先取 i18n；扩展项受 shared/i18n.ts（WIP 文件）约束，走本地硬编码。
const items = [
  { to: "/favorites", icon: "favorite", title: t("nav.favorites"), sub: t("navDesc.favorites") },
  { to: "/history", icon: "history", title: t("nav.history"), sub: t("navDesc.history") },
  { to: "/trash", icon: "delete", title: t("nav.trash"), sub: t("navDesc.trash") },
  { to: "/extensions", icon: "extension", title: "扩展", sub: "已安装的扩展" },
];

function open(to: string) {
  void router.push(to);
}
</script>

<template>
  <div class="treasure-view">
    <h2 class="page-title">{{ t("settings.treasure.title") }}</h2>
    <p class="page-hint">{{ t("settings.treasure.subtitle") }}</p>

    <!-- M3E 连通分组列表（Connected List）：
         外容器圆角 28dp、列表项间距 3dp、单项高 72dp、背景 surfaceContainerLow、
         顶/底项外圆角 28dp、相邻内圆角 8dp。颜色全部引用 M3 语义令牌。 -->
    <m3e-list v-if="items.length" class="treasure-list" variant="segmented">
      <m3e-list-item v-for="item in items" :key="item.to" class="t-item" @click="open(item.to)">
        <span slot="leading" class="lead-circle">
          <span class="material-symbols-outlined">{{ item.icon }}</span>
        </span>
        <span class="li-title">{{ item.title }}</span>
        <span slot="supporting-text" class="li-sub">{{ item.sub }}</span>
        <span slot="trailing" class="material-symbols-outlined li-trail">chevron_right</span>
      </m3e-list-item>
    </m3e-list>
    <div v-else class="empty-state">
      <span class="material-symbols-outlined">inventory_2</span>
      <span>暂无内容</span>
    </div>

    <h3 class="section-title">更多工具</h3>
    <div class="card-grid">
      <button class="t-card" @click="router.push('/folders')">
        <span class="t-icon material-symbols-outlined">folder</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.folders") }}</div>
          <div class="t-desc">{{ t("settings.treasure.foldersHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/webdav')">
        <span class="t-icon material-symbols-outlined">cloud</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.webdav") }}</div>
          <div class="t-desc">{{ t("settings.treasure.webdavHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/treasure/market')">
        <span class="t-icon material-symbols-outlined">storefront</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.market") }}</div>
          <div class="t-desc">{{ t("settings.treasure.marketHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/stats')">
        <span class="t-icon material-symbols-outlined">bar_chart</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.stats") }}</div>
          <div class="t-desc">{{ t("settings.treasure.statsHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>

      <button class="t-card" @click="router.push('/novel-stats')">
        <span class="t-icon material-symbols-outlined">menu_book</span>
        <div class="t-body">
          <div class="t-name">{{ t("settings.treasure.novelStats") }}</div>
          <div class="t-desc">{{ t("settings.treasure.novelStatsHint") }}</div>
        </div>
        <span class="material-symbols-outlined t-arrow">chevron_right</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.treasure-view {
  max-width: 600px;
  margin: 0 auto;
}
.page-title {
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: var(--md-sys-typescale-title-large-weight);
  margin: 0 0 4px;
}
.page-hint {
  margin: 0 0 20px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

/* ---- 连通分组列表令牌（M3E 原生，不手写圆角 CSS）---- */
.treasure-list {
  --m3e-segmented-list-container-shape: 28px;
  --m3e-segmented-list-segment-gap: 3px;
  --m3e-segmented-list-item-container-color: var(--md-sys-color-surface-container-low);
  --m3e-segmented-list-item-container-shape: 8px;
  --m3e-segmented-list-item-hover-container-shape: 8px;
  --m3e-segmented-list-item-focus-container-shape: 8px;
  --m3e-segmented-list-item-selected-container-shape: 8px;
  --m3e-list-item-two-line-height: 72px;
  --m3e-list-item-font-size: var(--md-sys-typescale-body-large-size);
  --m3e-list-item-font-weight: 400;
  --m3e-list-item-line-height: var(--md-sys-typescale-body-large-line-height);
  --m3e-list-item-supporting-text-font-size: var(--md-sys-typescale-body-medium-size);
  --m3e-list-item-supporting-text-font-weight: 400;
  --m3e-list-item-supporting-text-color: var(--md-sys-color-on-surface-variant);
  --m3e-list-item-leading-space: 16px;
  --m3e-list-item-trailing-space: 16px;
}
.t-item {
  cursor: pointer;
}
/* 左侧 40dp 圆形容器：primaryContainer 底、onPrimaryContainer 图标 */
.lead-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  background: var(--md-sys-color-primary-container);
  color: var(--md-sys-color-on-primary-container);
}
.lead-circle .material-symbols-outlined {
  font-size: 24px;
}
.li-title {
  color: var(--md-sys-color-on-surface);
}
.li-sub {
  color: var(--md-sys-color-on-surface-variant);
}
.li-trail {
  font-size: 24px;
  color: var(--md-sys-color-on-surface-variant);
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 40px 0;
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-body-medium-size);
}
.empty-state .material-symbols-outlined {
  font-size: 40px;
}

.section-title {
  margin: 28px 0 12px;
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 500;
  color: var(--md-sys-color-on-surface-variant);
}

/* ---- 既有工具卡片（保留）---- */
.card-grid {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.t-card {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px 22px;
  border: none;
  border-radius: var(--lm-shape-card);
  background: var(--md-sys-color-surface-container-low);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
  transition:
    transform 200ms var(--md-sys-motion-spring-soft),
    box-shadow 200ms var(--md-sys-motion-spring-effects-fast);
}
.t-card:hover {
  transform: translateY(-2px);
  box-shadow:
    var(--md-elevation-2),
    inset 0 0 0 1px var(--lm-hairline);
}
.t-card:active {
  transform: scale(0.98);
}
.t-icon {
  font-size: 36px;
  color: var(--md-sys-color-primary);
  flex: none;
}
.t-body {
  flex: 1;
  min-width: 0;
}
.t-name {
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.t-desc {
  margin-top: 4px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.t-arrow {
  font-size: 22px;
  color: var(--md-sys-color-on-surface-variant);
  opacity: 0.5;
}
</style>
