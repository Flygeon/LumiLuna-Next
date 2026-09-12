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

// 更多工具（文件夹浏览 / WebDAV / 音效预设市场 / 时长统计 / 阅读统计）。
// 与上方百宝箱核心项共用同一套 M3E 连通列表结构，避免两段列表风格割裂。
const tools = [
  {
    to: "/folders",
    icon: "folder",
    title: t("settings.treasure.folders"),
    sub: t("settings.treasure.foldersHint"),
  },
  {
    to: "/webdav",
    icon: "cloud",
    title: t("settings.treasure.webdav"),
    sub: t("settings.treasure.webdavHint"),
  },
  {
    to: "/treasure/market",
    icon: "storefront",
    title: t("settings.treasure.market"),
    sub: t("settings.treasure.marketHint"),
  },
  {
    to: "/stats",
    icon: "bar_chart",
    title: t("settings.treasure.stats"),
    sub: t("settings.treasure.statsHint"),
  },
  {
    to: "/novel-stats",
    icon: "menu_book",
    title: t("settings.treasure.novelStats"),
    sub: t("settings.treasure.novelStatsHint"),
  },
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
    <m3e-list v-if="tools.length" class="treasure-list" variant="segmented">
      <m3e-list-item v-for="tool in tools" :key="tool.to" class="t-item" @click="open(tool.to)">
        <span slot="leading" class="lead-circle">
          <span class="material-symbols-outlined">{{ tool.icon }}</span>
        </span>
        <span class="li-title">{{ tool.title }}</span>
        <span slot="supporting-text" class="li-sub">{{ tool.sub }}</span>
        <span slot="trailing" class="material-symbols-outlined li-trail">chevron_right</span>
      </m3e-list-item>
    </m3e-list>
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
</style>
