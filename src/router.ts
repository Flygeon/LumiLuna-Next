import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/images" },
    { path: "/images", component: () => import("@/views/ImagesView.vue") },
    { path: "/videos", component: () => import("@/views/VideosView.vue") },
    { path: "/music", component: () => import("@/views/MusicView.vue") },
    { path: "/music/player", component: () => import("@/views/PlayerView.vue") },
    { path: "/books", component: () => import("@/views/BooksView.vue") },
    { path: "/folders", component: () => import("@/views/FoldersView.vue") },
    { path: "/webdav", component: () => import("@/views/WebDavView.vue") },
    { path: "/treasure", component: () => import("@/views/TreasureView.vue") },
    { path: "/treasure/market", component: () => import("@/views/PresetMarket.vue") },
    { path: "/favorites", component: () => import("@/views/FavoritesView.vue") },
    { path: "/history", component: () => import("@/views/HistoryView.vue") },
    { path: "/trash", component: () => import("@/views/TrashView.vue") },
    { path: "/settings", component: () => import("@/views/SettingsView.vue") },
    { path: "/desktop-lyrics", component: () => import("@/views/DesktopLyrics.vue") },
  ],
});

export default router;