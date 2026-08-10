<script setup lang="ts">
import { onMounted, computed } from "vue";
import { useRouter, useRoute } from "vue-router";
import { useSettingsStore } from "@/stores/settings";
import { usePlayerStore } from "@/stores/player";
import MiniPlayer from "@/components/MiniPlayer.vue";
import { translate } from "@shared/i18n";

const settings = useSettingsStore();
const player = usePlayerStore();
const router = useRouter();
const route = useRoute();

const navItems = [
  { key: "images", path: "/images" },
  { key: "videos", path: "/videos" },
  { key: "music", path: "/music" },
  { key: "books", path: "/books" },
  { key: "folders", path: "/folders" },
];
const bottomItems = [
  { key: "favorites", path: "/favorites" },
  { key: "history", path: "/history" },
  { key: "trash", path: "/trash" },
  { key: "settings", path: "/settings" },
];

const icons: Record<string, string> = {
  images: "🖼️",
  videos: "🎬",
  music: "🎵",
  books: "📚",
  folders: "📁",
  favorites: "⭐",
  history: "🕘",
  trash: "🗑️",
  settings: "⚙️",
};

function t(key: string) {
  return translate(settings.lang, key);
}

function go(path: string) {
  router.push(path);
}

const isPlayerPage = () => route.path === "/music/player";
const currentTab = computed(() => {
  const p = route.path.split("/")[1];
  return p || "images";
});

onMounted(() => {
  settings.applyTheme(settings.theme);
});
</script>

<template>
  <div class="app-shell">
    <!-- 左侧导航 Rail -->
    <nav class="nav-rail" v-if="!isPlayerPage()">
      <div class="nav-brand">{{ t("app.name") }}</div>
      <div class="nav-main">
        <div
          v-for="item in navItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          @click="go(item.path)"
        >
          <span class="nav-icon">{{ icons[item.key] }}</span>
          <span class="nav-label">{{ t("nav." + item.key) }}</span>
        </div>
      </div>
      <div class="nav-bottom">
        <div
          v-for="item in bottomItems"
          :key="item.key"
          class="nav-item"
          :class="{ active: route.path === item.path }"
          @click="go(item.path)"
        >
          <span class="nav-icon">{{ icons[item.key] }}</span>
          <span class="nav-label">{{ t("nav." + item.key) }}</span>
        </div>
      </div>
    </nav>

    <!-- 内容区 -->
    <div class="content">
      <header class="topbar" v-if="!isPlayerPage()">
        <div class="topbar-title">{{ t("nav." + currentTab) }}</div>
        <div class="topbar-search">
          <input type="text" :placeholder="t('actions.search')" />
        </div>
        <button class="theme-btn" @click="settings.applyTheme(settings.theme === 'dark' ? 'light' : 'dark')">
          {{ settings.theme === "dark" ? "🌙" : "☀️" }}
        </button>
      </header>

      <main class="main-content">
        <router-view />
      </main>
    </div>

    <!-- 迷你播放条 -->
    <MiniPlayer v-if="!isPlayerPage() && player.song" />
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  height: 100vh;
  width: 100vw;
  background: var(--md-sys-color-background);
}
.nav-rail {
  width: 80px;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 12px 0;
  background: var(--md-sys-color-surface-container-low);
  border-right: 1px solid var(--md-sys-color-outline);
  gap: 8px;
}
.nav-brand {
  font-weight: 700;
  font-size: 13px;
  color: var(--md-sys-color-primary);
  margin-bottom: 12px;
  letter-spacing: 0.5px;
}
.nav-main {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  align-items: center;
}
.nav-bottom {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  align-items: center;
}
.nav-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 64px;
  padding: 8px 0;
  border-radius: var(--md-sys-shape-corner-medium);
  color: var(--md-sys-color-on-surface-variant);
  cursor: pointer;
  transition: background var(--md-sys-motion-duration-short) var(--md-sys-motion-easing-standard);
}
.nav-item:hover {
  background: var(--md-sys-color-surface-container-high);
}
.nav-item.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.nav-icon {
  font-size: 20px;
  line-height: 1;
}
.nav-label {
  font-size: 11px;
  margin-top: 3px;
}
.content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.topbar {
  height: 56px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 20px;
  background: var(--md-sys-color-surface-container-low);
  border-bottom: 1px solid var(--md-sys-color-outline);
}
.topbar-title {
  font-size: var(--md-sys-typescale-title-size);
  font-weight: var(--md-sys-typescale-title-weight);
}
.topbar-search input {
  width: 280px;
  padding: 8px 14px;
  border-radius: var(--md-sys-shape-corner-extra-large);
  border: 1px solid var(--md-sys-color-outline);
  background: var(--md-sys-color-surface);
  color: var(--md-sys-color-on-surface);
  outline: none;
}
.theme-btn {
  margin-left: auto;
  border: none;
  background: var(--md-sys-color-surface-container-high);
  border-radius: 50%;
  width: 40px;
  height: 40px;
  font-size: 18px;
  cursor: pointer;
}
.main-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}
</style>
