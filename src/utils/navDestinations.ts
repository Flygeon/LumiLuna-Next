/**
 * 主导航目标：App.vue 左侧导航栏与终端布局主页共用同一份定义，避免两处漂移。
 * 这里只描述"去哪"——文案取 i18n 的 nav.*，计数取 library.counts[type]。
 */
export interface NavDestination {
  key: string;
  path: string;
  icon: string;
  /** 媒体库计数类型；null = 该目标没有计数（百宝箱 / 设置） */
  type: string | null;
  /** 覆盖 i18n 文案（默认取 nav.<key>） */
  label?: string;
}

/** 主模块（侧栏上半区 / 终端主页模块矩阵） */
export const PRIMARY_DESTINATIONS: NavDestination[] = [
  { key: "images", path: "/images", icon: "image", type: "image" },
  { key: "videos", path: "/videos", icon: "movie", type: "video" },
  { key: "music", path: "/music", icon: "music_note", type: "audio" },
  { key: "books", path: "/books", icon: "menu_book", type: "book" },
  { key: "treasure", path: "/treasure", icon: "inventory_2", type: null },
];

/** 侧栏下半区（收藏 / 历史 / 回收站 / 扩展 已收纳进百宝箱） */
export const BOTTOM_DESTINATIONS: NavDestination[] = [
  { key: "settings", path: "/settings", icon: "settings", type: null, label: "" },
];

/** 二级页面标题（终端布局顶部命令条显示当前位置用）：路径 → i18n 键 */
export const SUB_PAGE_TITLES: Record<string, string> = {
  "/favorites": "nav.favorites",
  "/history": "nav.history",
  "/trash": "nav.trash",
  "/folders": "nav.folders",
  "/webdav": "nav.webdav",
  "/stats": "nav.stats",
  "/novel-stats": "novelStats.title",
  "/extensions": "nav.extensions",
  "/treasure/market": "settings.treasure.market",
};

/** 命中主/次导航目标（用于取标题与计数） */
export function destinationForPath(path: string): NavDestination | undefined {
  return [...PRIMARY_DESTINATIONS, ...BOTTOM_DESTINATIONS].find((d) => d.path === path);
}

/** 当前路径的标题 i18n 键；未收录的路径返回 undefined（调用方兜底） */
export function titleKeyForPath(path: string): string | undefined {
  const dest = destinationForPath(path);
  if (dest) return `nav.${dest.key}`;
  return SUB_PAGE_TITLES[path];
}
