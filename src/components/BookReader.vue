<script setup lang="ts">
/**
 * 内置阅读器：EPUB（epub.js）与 PDF（pdf.js）。
 *
 * 此前书籍页只调用 openPath 交给系统默认程序，若系统未关联
 * .epub/.pdf 就完全没有反应，表现为「点了没用」。现在改为应用内阅读，
 * 并保留「用系统应用打开」作为兜底。
 *
 * 文件通过 Tauri fs 读成 ArrayBuffer 再喂给两个库，避免依赖
 * asset:// 的 range 请求行为差异。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from "vue";
import { readFile } from "@tauri-apps/plugin-fs";
import { capabilities, isMobile, isTauri } from "@/capabilities";
import {
  useSettingsStore,
  type ReaderFontKey,
  type ReaderThemeKey,
} from "@/stores/settings";
import { loadPdfjs, toArrayBuffer } from "@/utils/pdf";
import { isLoginRequiredError } from "@/novel/wenku8Login";
import { requestRelogin } from "@/novel/wenku8Auth";
import type { MediaEntry, NovelContent, NovelVolume } from "@shared/types";

/** 阅读器背景主题：背景色 / 前景色 / 链接色 三元组 */
const READER_THEMES: Record<
  ReaderThemeKey,
  { label: string; bg: string; fg: string; link: string }
> = {
  dark: { label: "深色", bg: "#17171a", fg: "#e6e6e8", link: "#8bb9f0" },
  light: { label: "浅色", bg: "#f6f6f2", fg: "#33343a", link: "#1a5c9e" },
  sepia: { label: "羊皮纸", bg: "#ece4d6", fg: "#5a4a3a", link: "#8a6d3b" },
  green: { label: "护眼绿", bg: "#d6e3d2", fg: "#35433a", link: "#1a5c9e" },
};
const READER_THEME_KEYS = Object.keys(READER_THEMES) as ReaderThemeKey[];

/**
 * 纯文本书页的盒模型。桌面双栏；移动端强制单栏——手机屏宽（常见 360dp）
 * 分两栏后每列不足 150px，一行只能塞 5-6 个汉字，完全不可读。
 *
 * 必须集中在此定义：JS 分页探针（splitTextIntoPages）靠复刻 .text-page 的
 * 盒模型来判断溢出边界，两边取值一旦不一致，分页位置就会错。所以模板与
 * 探针共用这一份常量，CSS 里不再写死列数与内边距。
 */
const TEXT_PAGE_BOX = isMobile
  ? { columns: 1, gapPx: 0, padXPx: 20, padYPx: 24 }
  : { columns: 2, gapPx: 48, padXPx: 48, padYPx: 32 };
/** 绑定到 .text-page 的行内样式，与探针同源 */
const textPageStyle = {
  columnCount: String(TEXT_PAGE_BOX.columns),
  columnGap: `${TEXT_PAGE_BOX.gapPx}px`,
  padding: `${TEXT_PAGE_BOX.padYPx}px ${TEXT_PAGE_BOX.padXPx}px`,
};

/** 阅读器正文字体（系统字体栈，Windows / macOS 均可用） */
const READER_FONTS: Record<ReaderFontKey, { label: string; value: string }> = {
  system: {
    label: "默认",
    value:
      '"SarasaGothicSC-Regular","SFPro-Regular","Helvetica Neue","Microsoft YaHei",system-ui,sans-serif',
  },
  serif: { label: "宋体", value: 'Georgia,"Songti SC","SimSun",serif' },
  sans: {
    label: "黑体",
    value:
      '"Helvetica Neue","Microsoft YaHei","Hiragino Sans GB",sans-serif',
  },
  kai: { label: "楷体", value: '"KaiTi","STKaiti","Kai",cursive' },
  yuan: {
    label: "圆体",
    value: '"Yuanti SC","YouYuan","Microsoft JhengHei UI",sans-serif',
  },
};
const READER_FONT_KEYS = Object.keys(READER_FONTS) as ReaderFontKey[];

const props = defineProps<{
  item?: MediaEntry;
  novelSource?: {
    aid: string;
    title: string;
    initialCid?: string;
    initialChapterTitle?: string;
  };
}>();
const emit = defineEmits<{ (e: "close"): void }>();

const settings = useSettingsStore();

const host = ref<HTMLDivElement | null>(null);
/** 单页/双页模式下的画布容器；滚动模式下承载所有页 */
const pdfPane = ref<HTMLDivElement | null>(null);
const loading = ref(true);
const error = ref("");

const page = ref(1);
const totalPages = ref(0);
const zoom = ref(1.2);
/** 顶栏「更多设置」二级菜单是否展开 */
const menuOpen = ref(false);
/** 目录侧边栏是否展开（EPUB） */
const sidebarOpen = ref(false);
/** 展平后的 EPUB 目录 */
const toc = ref<{ label: string; href: string; depth: number }[]>([]);
/** 当前章节 href（高亮目录用） */
const currentHref = ref("");
/** 当前 CFI（进度保存用，非响应式） */
let progressLocation = "";

const kind = computed(() => {
  if (props.novelSource) return "text" as const;
  if (props.item?.ext.toLowerCase() === "pdf") return "pdf" as const;
  return "epub" as const;
});
const mode = computed(() => settings.pdfReadMode);
/** 双页模式一次前进两页 */
const step = computed(() => (mode.value === "dual" ? 2 : 1));

// ---- 阅读统计打点（本地，章节级）----
let readSessionId = "";
let readSessionStart = 0;
let readChapterKey = "";
let readChapterTitle = "";

function flushReadSession() {
  if (!readSessionId || !readSessionStart) return;
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - readSessionStart);
  if (durationMs >= 1000) {
    void capabilities.novelReadSessionEnd({
      id: readSessionId,
      bookId: props.item?.id ?? "",
      source: "local",
      title: props.item?.title || props.item?.name || "",
      chapterKey: readChapterKey || "0",
      chapterTitle: readChapterTitle || props.item?.title || props.item?.name || "",
      startedAt: readSessionStart,
      endedAt,
      durationMs,
      completed: false,
    });
  }
  readSessionId = "";
  readSessionStart = 0;
  readChapterKey = "";
  readChapterTitle = "";
}

function beginReadSession(key: string, title: string) {
  flushReadSession();
  readSessionId = crypto.randomUUID();
  readSessionStart = Date.now();
  readChapterKey = key;
  readChapterTitle = title;
}

/** 当前背景主题（chrome 与 EPUB 正文共用） */
const theme = computed(
  () => READER_THEMES[settings.readerTheme] ?? READER_THEMES.dark,
);
/** 当前正文字体 */
const readerFont = computed(
  () => READER_FONTS[settings.readerFont] ?? READER_FONTS.system,
);
/** EPUB/在线文本是否可翻页（PDF 滚动模式下不显示点击翻页） */
const canNav = computed(
  () => !loading.value && !error.value && (kind.value !== "pdf" || mode.value !== "scroll"),
);

// 这些库的实例不需要响应式深追踪
const book = shallowRef<any>(null);
const rendition = shallowRef<any>(null);
const pdfDoc = shallowRef<any>(null);
const pdfLoadingTask = shallowRef<any>(null);
let renderTasks: any[] = [];

async function loadBytes(): Promise<ArrayBuffer> {
  if (!isTauri || !props.item) throw new Error("仅在应用内可读取本地文件");
  const bytes = await readFile(props.item.path);
  return toArrayBuffer(bytes);
}

// ---- PDF ----

async function openPdf() {
  const pdfjs = await loadPdfjs();
  const data = await loadBytes();
  // destroy() 挂在 loadingTask 上，PDFDocumentProxy 没有该方法
  pdfLoadingTask.value = pdfjs.getDocument({ data });
  pdfDoc.value = await pdfLoadingTask.value.promise;
  totalPages.value = pdfDoc.value.numPages;
  page.value = 1;
  await renderPdf();
}

function cancelRenders() {
  renderTasks.forEach((t) => t?.cancel?.());
  renderTasks = [];
}

/** 把第 n 页画到一个新建的 canvas 上 */
async function renderPageTo(n: number, container: HTMLElement) {
  const doc = pdfDoc.value;
  if (!doc || n < 1 || n > doc.numPages) return;

  const pdfPage = await doc.getPage(n);
  const viewport = pdfPage.getViewport({ scale: zoom.value });

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 按设备像素比渲染，高分屏下不糊
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(viewport.width * dpr);
  canvas.height = Math.floor(viewport.height * dpr);
  canvas.style.width = `${Math.floor(viewport.width)}px`;
  canvas.style.height = `${Math.floor(viewport.height)}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  container.appendChild(canvas);

  const task = pdfPage.render({ canvasContext: ctx, viewport });
  renderTasks.push(task);
  try {
    await task.promise;
  } catch (e: any) {
    if (e?.name !== "RenderingCancelledException") throw e;
  }
}

/** 依据阅读模式渲染当前视图 */
async function renderPdf() {
  const pane = pdfPane.value;
  const doc = pdfDoc.value;
  if (!pane || !doc) return;

  cancelRenders();
  pane.innerHTML = "";

  if (mode.value === "scroll") {
    // 连续滚动：一次性铺开所有页，逐页顺序绘制
    for (let n = 1; n <= doc.numPages; n++) {
      await renderPageTo(n, pane);
    }
    return;
  }

  await renderPageTo(page.value, pane);
  if (mode.value === "dual" && page.value + 1 <= doc.numPages) {
    await renderPageTo(page.value + 1, pane);
  }
}

// ---- EPUB ----

/**
 * 把全部阅读设置（背景色/前景色/链接色/字体/字号/行距/段间距）序列化成一个
 * CSS 字符串。epub.js 的 themes.registerCss 在章节切换时不会自动重新注入
 * （inject 钩子只认 rules/url 主题），因此这里自己挂 content 钩子，用同一 key
 * 整体替换 <style> 的 innerHTML——幂等、不累积，且每个新章节都会自动套用。
 */
function buildThemeCss(): string {
  const t = theme.value;
  const para = settings.readerParaSpacing;
  return `
    body {
      background-color: ${t.bg} !important;
      color: ${t.fg} !important;
      font-family: ${readerFont.value.value} !important;
      font-size: ${settings.readerFontPct}% !important;
      line-height: ${settings.readerLineHeight} !important;
      padding: 0 8px;
    }
    a { color: ${t.link} !important; }
    img, image { max-width: 100%; height: auto; }
    ${para > 0 ? `p { margin: ${para}px 0 !important; }` : ""}
  `;
}

/** 对当前所有已渲染的内容覆写阅读样式 */
function applyEpubTheme() {
  const r = rendition.value;
  if (!r) return;
  const css = buildThemeCss();
  r.getContents().forEach((c: any) => {
    c?.addStylesheetCss?.(css, "lumiluna");
  });
}

async function openEpub() {
  const ePub = (await import("epubjs")).default;
  const data = await loadBytes();
  book.value = ePub(data);

  rendition.value = book.value.renderTo(host.value!, {
    width: "100%",
    height: "100%",
    spread: "auto",
    allowScriptedContent: false,
  });

  // 每个章节内容注入完成后，套用当前阅读样式；display 后再补一次兜底
  rendition.value.hooks.content.register((contents: any) => {
    contents?.addStylesheetCss?.(buildThemeCss(), "lumiluna");
  });
  applyEpubTheme();
  await rendition.value.display();
  applyEpubTheme();

  const nav = await book.value.loaded.navigation;
  totalPages.value = nav?.toc?.length ?? 0;
  toc.value = flattenToc(nav?.toc ?? []);

  rendition.value.on("relocated", (location: any) => {
    page.value = (location?.start?.index ?? 0) + 1;
    currentHref.value = location?.start?.href ?? "";
    progressLocation = location?.start?.cfi ?? "";
    saveProgress();
  });

  // 恢复上次阅读进度（CFI 精确定位）
  try {
    if (props.item) {
      const progress = await capabilities.getBookProgress(props.item.id);
      if (progress?.location) {
        await rendition.value.display(progress.location);
      }
    }
  } catch {
    /* 恢复失败忽略，回到开头 */
  }

  // epub.js 的 iframe 会吞掉键盘事件，需在其内部再挂一次
  rendition.value.on("keyup", onKey);
}

/** 展平 EPUB 目录（含嵌套子章节，带层级） */
function flattenToc(
  items: any[],
  depth = 0,
): { label: string; href: string; depth: number }[] {
  const out: { label: string; href: string; depth: number }[] = [];
  for (const it of items ?? []) {
    out.push({ label: it.label, href: it.href ?? "", depth });
    if (it.subitems?.length) out.push(...flattenToc(it.subitems, depth + 1));
  }
  return out;
}

/** 保存阅读进度（EPUB：CFI + 章节 + 粗略百分比） */
function saveProgress() {
  const location = progressLocation;
  if (!location || kind.value !== "epub" || !props.item) return;
  const percent = totalPages.value ? ((page.value - 1) / totalPages.value) * 100 : 0;
  void capabilities
    .saveBookProgress(props.item.id, location, page.value, Math.round(percent))
    .catch(() => {});
}

/** 目录项是否为当前章节（精确匹配或 href 互为前缀） */
function isTocActive(item: { href: string }): boolean {
  const cur = currentHref.value;
  if (!cur || !item.href) return false;
  return cur === item.href || cur.startsWith(item.href) || item.href.startsWith(cur);
}

/** 根据 TOC href 找 spine 索引（处理相对路径/编码/目录前缀差异），找不到返回 -1 */
function findSpineIndex(href: string): number {
  const items = book.value?.spine?.items;
  if (!items?.length) return -1;
  const clean = href.split("#")[0];
  const tBase = clean.split("/").pop() ?? "";
  for (let i = 0; i < items.length; i++) {
    const h = items[i].href ?? "";
    const hClean = h.split("#")[0];
    if (h === clean || h === decodeURI(clean) || decodeURI(h) === clean) return i;
    // 文件名相等兜底（目录前缀不同也能跳）
    if (tBase && (hClean.split("/").pop() ?? "") === tBase) return i;
  }
  return -1;
}

/** 点击目录跳转到指定章节 */
async function goToChapter(item: { href: string }) {
  sidebarOpen.value = false;
  if (!item.href) return;
  const r = rendition.value;
  if (!r) return;
  const idx = findSpineIndex(item.href);
  try {
    // display 内部用 spine.get() 精确匹配 href，TOC 与 spine 路径格式不一致会
    // 查不到而 reject；用数字索引（必然命中）最稳
    if (idx >= 0) await r.display(idx);
    else await r.display(item.href);
  } catch {
    /* 跳转失败忽略（保留原位置） */
  }
}

// ---- 在线小说纯文本 ----

const textVolumes = ref<NovelVolume[]>([]);
const textChapters = ref<{ cid: string; title: string }[]>([]);
const textCurrentIndex = ref(0);
const textCurrentCid = ref("");
const textCurrentTitle = ref("");
const textContent = ref<NovelContent | null>(null);
const textScrollEl = ref<HTMLDivElement | null>(null);
const textTrackEl = ref<HTMLDivElement | null>(null);
/** 按页拆分后的段落列表（每页 = 一组段落，CSS multicolumn 自动分 2 列） */
const textPages = ref<string[][]>([]);
/** 当前页码（0-based），顶栏显示进度 */
const textCurrentPage = ref(0);
/** 待恢复的页码：initText 从阅读进度读到后暂存，首次分页完成时消费一次 */
let pendingRestorePage = 0;

let textSessionId = "";
let textSessionStart = 0;
let textChapterKey = "";

function flattenTextChapters(volumes: NovelVolume[]) {
  const list: { cid: string; title: string }[] = [];
  for (const v of volumes) list.push(...v.chapters);
  return list;
}

function flushTextSession() {
  if (!textSessionId || !textSessionStart || !textChapterKey) return;
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - textSessionStart);
  if (durationMs >= 1000) {
    void capabilities.novelReadSessionEnd({
      id: textSessionId,
      bookId: props.novelSource!.aid,
      source: "online",
      title: props.novelSource!.title,
      chapterKey: textChapterKey,
      chapterTitle: textCurrentTitle.value,
      startedAt: textSessionStart,
      endedAt,
      durationMs,
      completed: false,
    });
  }
  textSessionId = "";
  textSessionStart = 0;
  textChapterKey = "";
}

function beginTextSession() {
  flushTextSession();
  textSessionId = crypto.randomUUID();
  textSessionStart = Date.now();
  textChapterKey = textCurrentCid.value;
}

/** 保存在线阅读进度：当前章节 cid + 章节内页码（position）。翻页与卸载时调用。 */
function saveTextProgress() {
  if (kind.value !== "text" || !props.novelSource || !textCurrentCid.value) return;
  void capabilities.novelProgressSet(
    props.novelSource.aid,
    textCurrentCid.value,
    textCurrentTitle.value,
    textCurrentPage.value,
  );
}

async function loadTextChapter(index: number) {
  if (index < 0 || index >= textChapters.value.length) return;
  textCurrentIndex.value = index;
  const ch = textChapters.value[index];
  textCurrentCid.value = ch.cid;
  textCurrentTitle.value = ch.title;
  loading.value = true;
  error.value = "";
  try {
    textContent.value = await capabilities.novelContent(
      settings.wenku8Node,
      settings.novelCharset,
      props.novelSource!.aid,
      ch.cid,
      ch.title,
    );
    beginTextSession();
    void capabilities.novelProgressSet(props.novelSource!.aid, ch.cid, ch.title, 0);
  } catch (e) {
    if (isLoginRequiredError(e)) {
      requestRelogin();
      error.value = "登录态已失效，请重新登录。";
    } else {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    loading.value = false;
    await splitTextIntoPages();
    if (textTrackEl.value) textTrackEl.value.scrollLeft = 0;
  }
}

/**
 * 将章节正文按页拆分。每页严格 TEXT_PAGE_BOX.columns 列
 * （桌面 2 列 / 移动端 1 列，CSS column-count + overflow:hidden）。
 * 用隐藏测量元素逐段添加，检测 scrollWidth 溢出来确定分页边界——
 * 根除 CSS multicolumn 在 overflow:auto 下产生多余列的浏览器怪癖。
 * （溢出内容会在 inline 方向生成额外列，故单栏时同样能靠 scrollWidth 判定）
 */
async function splitTextIntoPages() {
  // 消费一次待恢复页码：无论走哪条分支都清空，避免残留到后续（如字号变更）重排
  const restoreTarget = pendingRestorePage;
  pendingRestorePage = 0;
  const container = textScrollEl.value;
  if (!container || !textContent.value) {
    textPages.value = [];
    textCurrentPage.value = 0;
    return;
  }
  const allParas = (textContent.value.text || "").split("\n\n").filter((p) => p.trim());
  if (!allParas.length) {
    textPages.value = [];
    textCurrentPage.value = 0;
    return;
  }
  // 等 DOM 更新后拿容器尺寸
  await nextTick();
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  if (cw === 0 || ch === 0) {
    // 容器不可见（loading 遮盖等），退化为单页
    textPages.value = [allParas];
    textCurrentPage.value = 0;
    return;
  }
  const cs = getComputedStyle(container);
  const paraMB = settings.readerParaSpacing + "em";

  // 隐藏测量元素：复刻 .text-page 的盒模型与字体
  const probe = document.createElement("div");
  probe.style.cssText = [
    "position:absolute",
    "top:-9999px",
    "left:-9999px",
    `width:${cw}px`,
    `height:${ch}px`,
    "overflow:hidden",
    `column-count:${TEXT_PAGE_BOX.columns}`,
    `column-gap:${TEXT_PAGE_BOX.gapPx}px`,
    "column-fill:auto",
    `padding:${TEXT_PAGE_BOX.padYPx}px ${TEXT_PAGE_BOX.padXPx}px`,
    "box-sizing:border-box",
    `font-family:${cs.fontFamily}`,
    `font-size:${cs.fontSize}`,
    `line-height:${cs.lineHeight}`,
    "visibility:hidden",
  ].join(";");
  document.body.appendChild(probe);

  const paraHTML = (p: string) =>
    `<p style="margin:0 0 ${paraMB};white-space:pre-wrap;word-break:break-word;">${p}</p>`;
  const titleHTML = () =>
    `<h2 style="margin:0 0 16px;font-size:18px;font-weight:600;text-align:center;break-inside:avoid;">${textCurrentTitle.value}</h2>`;

  const pages: string[][] = [];
  let cur: string[] = [];
  let firstPage = true;

  for (const para of allParas) {
    cur.push(para);
    let html = "";
    if (firstPage) html += titleHTML();
    html += cur.map(paraHTML).join("");
    probe.innerHTML = html;
    if (probe.scrollWidth > cw + 1) {
      // 溢出：最后一段移到下一页
      cur.pop();
      if (cur.length) pages.push(cur);
      cur = [para];
      firstPage = false;
    }
  }
  if (cur.length) pages.push(cur);
  document.body.removeChild(probe);

  textPages.value = pages.length ? pages : [[]];
  const restorePage = Math.min(
    Math.max(0, restoreTarget),
    textPages.value.length - 1,
  );
  textCurrentPage.value = restorePage;
  await nextTick();
  // .text-content(textScrollEl, overflow:hidden) 才是真正的横向滚动容器
  if (textScrollEl.value) {
    textScrollEl.value.scrollLeft = restorePage * textScrollEl.value.clientWidth;
  }
}

function textPrev() {
  if (textCurrentIndex.value > 0) void loadTextChapter(textCurrentIndex.value - 1);
}
function textNext() {
  if (textCurrentIndex.value < textChapters.value.length - 1) void loadTextChapter(textCurrentIndex.value + 1);
}

async function initText() {
  loading.value = true;
  error.value = "";
  try {
    textVolumes.value = await capabilities.novelCatalogue(settings.wenku8Node, settings.novelCharset, props.novelSource!.aid);
    textChapters.value = flattenTextChapters(textVolumes.value);
    let start = 0;
    const progress = await capabilities.novelProgressGet(props.novelSource!.aid);
    if (progress) {
      const idx = textChapters.value.findIndex((c) => c.cid === progress.cid);
      if (idx >= 0) {
        start = idx;
        // 恢复章节内页码；具体页号在分页完成后 clamp 并消费
        pendingRestorePage = Math.max(0, progress.position || 0);
      }
    } else if (props.novelSource!.initialCid) {
      const idx = textChapters.value.findIndex((c) => c.cid === props.novelSource!.initialCid);
      if (idx >= 0) start = idx;
    }
    if (textChapters.value.length === 0) {
      error.value = "目录为空，无法阅读";
      loading.value = false;
      return;
    }
    await loadTextChapter(start);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    loading.value = false;
  }
}

// ---- 通用导航 ----

async function nextPage() {
  if (kind.value === "pdf") {
    // 滚动模式下整篇连续，翻页交给滚动条
    if (mode.value === "scroll") return;
    if (page.value + step.value <= totalPages.value) {
      page.value += step.value;
      await renderPdf();
    }
  } else if (kind.value === "text") {
    if (textCurrentPage.value < textPages.value.length - 1) {
      textCurrentPage.value++;
      const el = textScrollEl.value;
      if (el) el.scrollTo({ left: textCurrentPage.value * el.clientWidth });
      saveTextProgress();
      return;
    }
    textNext();
  } else {
    await rendition.value?.next();
  }
}

async function prevPage() {
  if (kind.value === "pdf") {
    if (mode.value === "scroll") return;
    if (page.value > 1) {
      page.value = Math.max(1, page.value - step.value);
      await renderPdf();
    }
  } else if (kind.value === "text") {
    if (textCurrentPage.value > 0) {
      textCurrentPage.value--;
      const el = textScrollEl.value;
      if (el) el.scrollTo({ left: textCurrentPage.value * el.clientWidth });
      saveTextProgress();
      return;
    }
    textPrev();
  } else {
    await rendition.value?.prev();
  }
}

async function setZoom(delta: number) {
  if (kind.value === "pdf") {
    zoom.value = Math.min(4, Math.max(0.5, zoom.value + delta));
    await renderPdf();
  } else {
    settings.readerFontPct = Math.min(
      220,
      Math.max(60, settings.readerFontPct + delta * 20),
    );
    if (kind.value === "epub") applyEpubTheme();
  }
}

/** 左/右点击翻页；二级菜单展开时不翻页（由遮罩负责收起） */
function onTapZone(dir: "prev" | "next") {
  if (menuOpen.value) return;
  void (dir === "prev" ? prevPage() : nextPage());
}

// ---- 移动端左右滑动翻页 ----
// 移动端隐藏了悬浮翻页按钮（44px 圆钮会压住正文），点击热区只占两侧
// 各 26%，中间大片区域需要手势才能翻页。滑动是阅读器的默认预期交互。
// 只认「横向为主」的滑动，纵向滚动（PDF 滚动模式）不受影响；也不
// preventDefault，避免吞掉原生滚动。
const SWIPE_MIN_PX = 48;
let touchX = 0;
let touchY = 0;
let touchTracking = false;

function onTouchStart(e: TouchEvent) {
  if (!isMobile || e.touches.length !== 1) {
    touchTracking = false;
    return;
  }
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
  touchTracking = true;
}

function onTouchEnd(e: TouchEvent) {
  if (!touchTracking) return;
  touchTracking = false;
  if (menuOpen.value || sidebarOpen.value || !canNav.value) return;
  const t = e.changedTouches[0];
  if (!t) return;
  const dx = t.clientX - touchX;
  const dy = t.clientY - touchY;
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) <= Math.abs(dy)) return;
  // 左滑（dx<0）= 下一页，与横向翻页方向一致
  void (dx < 0 ? nextPage() : prevPage());
}

function onKey(e: KeyboardEvent) {
  // 菜单/侧边栏展开时 Esc 先收面板，避免误关整个阅读器
  if (e.key === "Escape") {
    if (menuOpen.value) menuOpen.value = false;
    else if (sidebarOpen.value) sidebarOpen.value = false;
    else emit("close");
    return;
  }
  switch (e.key) {
    case "ArrowRight":
    case "PageDown":
      void nextPage();
      break;
    case "ArrowLeft":
    case "PageUp":
      void prevPage();
      break;
  }
}

onMounted(async () => {
  window.addEventListener("keydown", onKey);
  if (kind.value === "text") {
    await initText();
  } else {
    beginReadSession(kind.value === "pdf" ? "p1" : "start", props.item?.title || props.item?.name || "");
    try {
      if (kind.value === "pdf") await openPdf();
      else await openEpub();
    } catch (e) {
      error.value = `无法打开此文件：${e instanceof Error ? e.message : String(e)}`;
    } finally {
      loading.value = false;
    }
  }
});

onBeforeUnmount(() => {
  flushReadSession();
  flushTextSession();
  saveProgress();
  saveTextProgress();
  window.removeEventListener("keydown", onKey);
  cancelRenders();
  rendition.value?.destroy();
  book.value?.destroy();
  void pdfLoadingTask.value?.destroy();
});

// 本地阅读打点：PDF 页码 / EPUB 章节位置变化时结算上一段
watch(page, (v) => {
  if (kind.value === "pdf" && pdfDoc.value) beginReadSession(`p${v}`, `第 ${v} 页`);
});
watch(currentHref, (v) => {
  if (kind.value === "epub" && rendition.value) beginReadSession(v || "0", v || "");
});

// 切换阅读模式或缩放后重绘 PDF
watch([mode, zoom], () => {
  if (kind.value === "pdf" && pdfDoc.value) void renderPdf();
});

// 阅读设置（背景/字体/字号/行距/段间距）变化时，同步覆写 EPUB 正文样式；
// 在线文本模式则重新分页（字号/行距变化会改变内容高度）
watch(
  () => [
    settings.readerTheme,
    settings.readerFont,
    settings.readerFontPct,
    settings.readerLineHeight,
    settings.readerParaSpacing,
  ],
  () => {
    if (kind.value === "epub" && rendition.value) applyEpubTheme();
    if (kind.value === "text" && textContent.value) void splitTextIntoPages();
  },
);

function openExternally() {
  if (props.item?.path) void capabilities.openFile(props.item.path);
}

const PDF_MODES = [
  { key: "single" as const, icon: "description", label: "单页" },
  { key: "dual" as const, icon: "auto_stories", label: "双页" },
  { key: "scroll" as const, icon: "view_day", label: "滚动" },
];
</script>

<template>
  <div
    class="reader"
    :style="{
      '--reader-bg': theme.bg,
      '--reader-fg': theme.fg,
    }"
  >
    <header class="bar">
      <button class="rbtn" title="关闭 (Esc)" @click="emit('close')">
        <span class="material-symbols-outlined">close</span>
      </button>
      <div class="title" :title="item?.path">{{ novelSource?.title || item?.title || item?.name }}</div>
      <div class="pager" v-if="totalPages || textChapters.length">
        <span class="tabular-nums">
          {{
            kind === "pdf"
              ? mode === "scroll"
                ? `共 ${totalPages} 页`
                : mode === "dual" && page + 1 <= totalPages
                  ? `${page}-${page + 1} / ${totalPages}`
                  : `${page} / ${totalPages}`
              : kind === "text"
                ? textPages.length > 1
                  ? `${textCurrentIndex + 1}/${textChapters.length} 章 · ${textCurrentPage + 1}/${textPages.length} 页`
                  : `${textCurrentIndex + 1} / ${textChapters.length}`
                : `第 ${page} 节`
          }}
        </span>
      </div>
      <div class="tools">
        <!-- 目录侧边栏（EPUB / 在线文本） -->
        <button
          v-if="kind === 'epub' || kind === 'text'"
          class="rbtn"
          :class="{ active: sidebarOpen }"
          title="目录"
          @click="sidebarOpen = !sidebarOpen"
        >
          <span class="material-symbols-outlined">toc</span>
        </button>
        <!-- PDF 阅读模式切换 -->
        <div v-if="kind === 'pdf'" class="modes">
          <button
            v-for="m in PDF_MODES"
            :key="m.key"
            class="mode-btn"
            :class="{ active: mode === m.key }"
            :title="m.label"
            @click="settings.pdfReadMode = m.key"
          >
            <span class="material-symbols-outlined">{{ m.icon }}</span>
          </button>
        </div>
        <!-- 背景颜色切换：桌面直接展示在顶栏；移动端顶栏塞不下这一排，
             收进「阅读设置」面板（见下方 set-row.swatch-row） -->
        <div v-if="!isMobile" class="swatches" title="背景颜色">
          <button
            v-for="k in READER_THEME_KEYS"
            :key="k"
            class="swatch"
            :class="{ active: settings.readerTheme === k }"
            :style="{ background: READER_THEMES[k].bg }"
            :title="READER_THEMES[k].label"
            @click="settings.readerTheme = k"
          ></button>
        </div>
        <button class="rbtn" title="缩小" @click="setZoom(-0.2)">
          <span class="material-symbols-outlined">zoom_out</span>
        </button>
        <button class="rbtn" title="放大" @click="setZoom(0.2)">
          <span class="material-symbols-outlined">zoom_in</span>
        </button>
        <!-- 更多设置二级菜单（字号/字体/行距/段间距） -->
        <button
          class="rbtn"
          :class="{ active: menuOpen }"
          title="阅读设置"
          @click="menuOpen = !menuOpen"
        >
          <span class="material-symbols-outlined">tune</span>
        </button>
        <button v-if="item" class="rbtn" title="用系统应用打开" @click="openExternally">
          <span class="material-symbols-outlined">open_in_new</span>
        </button>
      </div>
    </header>

    <!-- 二级菜单：展开后显示更多阅读设置 -->
    <transition name="pop">
      <div v-if="menuOpen" class="menu-backdrop" @click="menuOpen = false"></div>
    </transition>
    <transition name="pop">
      <div v-if="menuOpen" class="reader-settings" @click.stop>
        <!-- 移动端：顶栏放不下的背景色板挪到这里 -->
        <div v-if="isMobile" class="set-row">
          <span class="set-label">背景</span>
          <div class="swatches">
            <button
              v-for="k in READER_THEME_KEYS"
              :key="k"
              class="swatch"
              :class="{ active: settings.readerTheme === k }"
              :style="{ background: READER_THEMES[k].bg }"
              :title="READER_THEMES[k].label"
              @click="settings.readerTheme = k"
            ></button>
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">字号</span>
          <input
            type="range"
            min="60"
            max="220"
            step="5"
            v-model.number="settings.readerFontPct"
          />
          <span class="set-value tabular-nums">{{ settings.readerFontPct }}%</span>
        </div>
        <div class="set-row">
          <span class="set-label">字体</span>
          <div class="set-chips">
            <button
              v-for="k in READER_FONT_KEYS"
              :key="k"
              class="chip"
              :class="{ active: settings.readerFont === k }"
              @click="settings.readerFont = k"
            >
              {{ READER_FONTS[k].label }}
            </button>
          </div>
        </div>
        <div class="set-row">
          <span class="set-label">行距</span>
          <input
            type="range"
            min="1"
            max="2.6"
            step="0.1"
            v-model.number="settings.readerLineHeight"
          />
          <span class="set-value tabular-nums">{{
            settings.readerLineHeight.toFixed(1)
          }}</span>
        </div>
        <div class="set-row">
          <span class="set-label">段间距</span>
          <input
            type="range"
            min="0"
            max="24"
            step="2"
            v-model.number="settings.readerParaSpacing"
          />
          <span class="set-value tabular-nums">{{
            settings.readerParaSpacing === 0
              ? "原书"
              : settings.readerParaSpacing + "px"
          }}</span>
        </div>
      </div>
    </transition>

    <!-- 目录侧边栏（EPUB / 在线文本）：遮罩 + 面板 -->
    <transition name="fade">
      <div v-if="sidebarOpen" class="toc-backdrop" @click="sidebarOpen = false"></div>
    </transition>
    <transition name="slide">
      <aside v-if="sidebarOpen" class="toc-panel">
        <div class="toc-head">
          <span class="material-symbols-outlined">toc</span>
          <span class="toc-title">目录</span>
          <span v-if="totalPages || textChapters.length" class="toc-pct tabular-nums">
            {{
              kind === "text" && textChapters.length
                ? Math.round((textCurrentIndex / textChapters.length) * 100) + "%"
                : totalPages
                  ? Math.round(((page - 1) / totalPages) * 100) + "%"
                  : ""
            }}
          </span>
        </div>
        <div class="toc-list">
          <!-- EPUB 目录 -->
          <template v-if="kind === 'epub'">
            <button
              v-for="(item, i) in toc"
              :key="item.href + i"
              class="toc-item"
              :class="{ active: isTocActive(item), sub: item.depth > 0 }"
              :style="{ paddingLeft: 14 + item.depth * 18 + 'px' }"
              @click="goToChapter(item)"
            >{{ item.label }}</button>
          </template>
          <!-- 在线文本目录 -->
          <template v-if="kind === 'text'">
            <button
              v-for="(ch, i) in textChapters"
              :key="ch.cid"
              class="toc-item"
              :class="{ active: i === textCurrentIndex }"
              @click="sidebarOpen = false; loadTextChapter(i)"
            >{{ ch.title }}</button>
          </template>
          <p v-if="kind === 'epub' && !toc.length" class="toc-empty">本书无目录</p>
          <p v-if="kind === 'text' && !textChapters.length" class="toc-empty">暂无目录</p>
        </div>
      </aside>
    </transition>

    <div class="stage" @touchstart.passive="onTouchStart" @touchend.passive="onTouchEnd">
      <div v-if="loading" class="state">
        <div class="spinner"></div>
        <p>正在打开…</p>
      </div>

      <div v-else-if="error" class="state">
        <span class="material-symbols-outlined big">error</span>
        <p>{{ error }}</p>
        <button v-if="item" class="lm-btn lm-btn--filled" @click="openExternally">
          用系统应用打开
        </button>
      </div>

      <!-- PDF：单页/双页居中，滚动模式纵向排列 -->
      <div
        v-if="kind === 'pdf'"
        class="pdf-scroll"
        :class="`mode-${mode}`"
        :style="{ visibility: loading || error ? 'hidden' : 'visible' }"
      >
        <div ref="pdfPane" class="pdf-pane" :class="`mode-${mode}`"></div>
      </div>

      <!--
        EPUB 容器必须始终保持真实尺寸：epub.js 在 renderTo 时读取宿主的
        宽高来分栏，如果此刻是 display:none（v-show 隐藏），拿到的是 0×0，
        渲染出的 iframe 尺寸为空，表现为「打开了但一片空白」。
        因此这里用 visibility 占位，加载态由上层浮层遮盖。
      -->
      <div
        v-if="kind === 'epub'"
        ref="host"
        class="epub-host"
        :style="{ visibility: loading || error ? 'hidden' : 'visible' }"
      ></div>

      <!-- 在线小说纯文本 -->
      <div
        v-if="kind === 'text'"
        ref="textScrollEl"
        class="text-content"
        :style="{
          fontFamily: readerFont.value,
          fontSize: settings.readerFontPct + '%',
          lineHeight: settings.readerLineHeight,
          visibility: loading || error ? 'hidden' : 'visible',
        }"
      >
        <div v-if="textContent" class="text-track" ref="textTrackEl">
          <div
            v-for="(page, pi) in textPages"
            :key="pi"
            class="text-page"
            :style="textPageStyle"
          >
            <h2 v-if="pi === 0" class="text-chapter-title">{{ textCurrentTitle }}</h2>
            <p
              v-for="(para, i) in page"
              :key="i"
              class="text-para"
              :style="{ marginBottom: settings.readerParaSpacing + 'em' }"
            >{{ para }}</p>
          </div>
        </div>
      </div>

      <!-- 左/右点击翻页热区；中间留空保持内容可交互 -->
      <button
        v-if="canNav"
        class="tapzone left"
        @click="onTapZone('prev')"
      ></button>
      <button
        v-if="canNav"
        class="tapzone right"
        @click="onTapZone('next')"
      ></button>

      <button
        v-if="canNav"
        class="nav prev"
        title="上一页 (←)"
        @click="prevPage"
      >
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button
        v-if="canNav"
        class="nav next"
        title="下一页 (→)"
        @click="nextPage"
      >
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.reader {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  background: var(--reader-bg);
  color: var(--reader-fg);
  animation: fade 180ms ease;
}
@keyframes fade {
  from { opacity: 0; }
  to { opacity: 1; }
}

.bar {
  display: flex;
  align-items: center;
  gap: 14px;
  flex: none;
  padding: 10px 14px;
  border-bottom: 1px solid color-mix(in srgb, var(--reader-fg) 14%, transparent);
  background: color-mix(in srgb, var(--reader-fg) 9%, transparent);
}
.title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pager {
  font-size: 12px;
  opacity: 0.65;
  white-space: nowrap;
}
.tools {
  display: flex;
  gap: 2px;
}
.rbtn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
  transition: background 160ms;
}
.rbtn:hover {
  background: color-mix(in srgb, var(--reader-fg) 14%, transparent);
}
.rbtn.active {
  position: relative;
  z-index: 25;
  background: color-mix(in srgb, var(--reader-fg) 18%, transparent);
}
.rbtn .material-symbols-outlined {
  font-size: 20px;
}

/* 顶栏背景色切换：一行色板 */
.swatches {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  margin-right: 4px;
}
.swatch {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  border: 1px solid rgba(128, 128, 128, 0.5);
  padding: 0;
  cursor: pointer;
  transition: transform 120ms var(--md-sys-motion-spring);
}
.swatch:hover {
  transform: scale(1.18);
}
.swatch.active {
  box-shadow: 0 0 0 2px var(--reader-fg);
}

/* 二级菜单遮罩与面板 */
.menu-backdrop {
  position: fixed;
  inset: 0;
  z-index: 20;
}
.reader-settings {
  position: absolute;
  top: 54px;
  right: 14px;
  z-index: 30;
  width: 300px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  border-radius: var(--md-sys-shape-corner-large);
  background: color-mix(in srgb, var(--reader-bg) 90%, transparent);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border: 1px solid color-mix(in srgb, var(--reader-fg) 15%, transparent);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}
.set-row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.set-label {
  flex: none;
  width: 52px;
  font-size: 13px;
  color: color-mix(in srgb, var(--reader-fg) 80%, transparent);
}
.set-row input[type="range"] {
  flex: 1;
  accent-color: var(--reader-fg);
}
.set-value {
  flex: none;
  min-width: 44px;
  text-align: right;
  font-size: 12px;
  opacity: 0.7;
}
.set-chips {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.set-chips .chip {
  height: 28px;
  padding: 0 12px;
  border-radius: 14px;
  border: 1px solid color-mix(in srgb, var(--reader-fg) 24%, transparent);
  background: transparent;
  color: var(--reader-fg);
  font-family: inherit;
  font-size: 12px;
  cursor: pointer;
  transition: all 160ms var(--md-sys-motion-easing-standard);
}
.set-chips .chip:hover {
  background: color-mix(in srgb, var(--reader-fg) 10%, transparent);
}
.set-chips .chip.active {
  background: var(--reader-fg);
  color: var(--reader-bg);
  border-color: transparent;
  font-weight: 600;
}
.pop-enter-active,
.pop-leave-active {
  transition:
    opacity 160ms var(--md-sys-motion-easing-standard),
    transform 160ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.pop-enter-from,
.pop-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}

/* 目录侧边栏 */
.toc-backdrop {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(0, 0, 0, 0.35);
}
.toc-panel {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 45;
  width: 300px;
  max-width: 80vw;
  display: flex;
  flex-direction: column;
  background: color-mix(in srgb, var(--reader-bg) 94%, transparent);
  backdrop-filter: blur(24px) saturate(1.6);
  -webkit-backdrop-filter: blur(24px) saturate(1.6);
  border-right: 1px solid color-mix(in srgb, var(--reader-fg) 15%, transparent);
  box-shadow: 0 0 40px rgba(0, 0, 0, 0.4);
}
.toc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  border-bottom: 1px solid color-mix(in srgb, var(--reader-fg) 12%, transparent);
  font-size: 14px;
  font-weight: 600;
}
.toc-head .material-symbols-outlined {
  font-size: 20px;
  opacity: 0.7;
}
.toc-title {
  flex: 1;
}
.toc-pct {
  font-size: 12px;
  opacity: 0.6;
}
.toc-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.toc-item {
  display: block;
  width: 100%;
  padding: 9px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--reader-fg) 78%, transparent);
  font-family: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transition: background 140ms;
}
.toc-item:hover {
  background: color-mix(in srgb, var(--reader-fg) 12%, transparent);
}
.toc-item.active {
  background: color-mix(in srgb, var(--reader-fg) 18%, transparent);
  color: var(--reader-fg);
  font-weight: 600;
}
.toc-item.sub {
  font-size: 12px;
  opacity: 0.85;
}
.toc-empty {
  padding: 20px;
  text-align: center;
  font-size: 13px;
  opacity: 0.5;
}
.fade-enter-active,
.fade-leave-active {
  transition: opacity 160ms ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
.slide-enter-active,
.slide-leave-active {
  transition: transform 240ms var(--md-sys-motion-easing-emphasized-decelerate);
}
.slide-enter-from,
.slide-leave-to {
  transform: translateX(-100%);
}

.stage {
  position: relative;
  flex: 1;
  overflow: hidden;
}

.pdf-scroll {
  height: 100%;
  overflow: auto;
  display: flex;
  justify-content: center;
  padding: 24px;
}
/* 单页/双页：内容居中且不参与纵向滚动堆叠 */
.pdf-pane {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  height: fit-content;
}
.pdf-pane.mode-scroll {
  flex-direction: column;
  align-items: center;
  gap: 20px;
}
.pdf-pane :deep(canvas) {
  background: #fff;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  border-radius: 2px;
  display: block;
}

.modes {
  display: flex;
  gap: 2px;
  padding: 2px;
  margin-right: 4px;
  border-radius: 18px;
  background: color-mix(in srgb, var(--reader-fg) 10%, transparent);
}
.mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: color-mix(in srgb, var(--reader-fg) 65%, transparent);
  cursor: pointer;
  transition: all 160ms ease;
}
.mode-btn:hover {
  color: var(--reader-fg);
  background: color-mix(in srgb, var(--reader-fg) 14%, transparent);
}
.mode-btn.active {
  background: var(--reader-fg);
  color: var(--reader-bg);
}
.mode-btn .material-symbols-outlined {
  font-size: 18px;
}

.epub-host {
  height: 100%;
  width: 100%;
  padding: 0 56px;
}

/* 在线小说纯文本 —— 双栏书页（JS 分页，每页严格 2 列） */
.text-content {
  height: 100%;
  overflow: hidden;
  position: relative;
  color: var(--reader-fg);
}
/* 横向轨道：承载所有分页，scrollLeft 控制翻页 */
.text-track {
  display: flex;
  height: 100%;
  /* scroll-snap 让翻页自动对齐页面边界，杜绝停在两页之间看到 3 列 */
  scroll-snap-type: x mandatory;
  scrollbar-width: none;
  -ms-overflow-style: none;
}
.text-track::-webkit-scrollbar {
  display: none;
}
/* 单页：列数/列间距/内边距由 textPageStyle 行内注入（与分页探针同源，
   桌面 2 列、移动端 1 列），此处只留与分页无关的盒属性 */
.text-page {
  flex: 0 0 100%;
  height: 100%;
  overflow: hidden;
  column-fill: auto;
  box-sizing: border-box;
  scroll-snap-align: start;
}
.text-chapter-title {
  margin: 0 0 16px;
  font-size: 18px;
  font-weight: 600;
  color: var(--reader-fg);
  text-align: center;
  break-inside: avoid;
}
.text-para {
  margin: 0 0 0.6em;
  white-space: pre-wrap;
  word-break: break-word;
  text-indent: 0;
  color: var(--reader-fg);
}

.state {
  position: absolute;
  inset: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  opacity: 0.85;
  text-align: center;
  padding: 24px;
  background: var(--reader-bg);
  color: var(--reader-fg);
}
.state .big {
  font-size: 56px;
  opacity: 0.5;
}
.spinner {
  width: 34px;
  height: 34px;
  border: 3px solid color-mix(in srgb, var(--reader-fg) 25%, transparent);
  border-top-color: var(--reader-fg);
  border-radius: 50%;
  animation: spin 700ms linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}

/* 左/右点击翻页热区：覆盖两侧，中间留空不挡内容 */
.tapzone {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 22%;
  z-index: 1;
  border: none;
  margin: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
}
.tapzone.left { left: 0; }
.tapzone.right { right: 0; }

.nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--reader-fg) 12%, transparent);
  color: var(--reader-fg);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 160ms;
  z-index: 2;
}
.nav:hover {
  background: color-mix(in srgb, var(--reader-fg) 24%, transparent);
}
.prev { left: 8px; }
.next { right: 8px; }
.nav .material-symbols-outlined {
  font-size: 26px;
}

/* ============ 移动端适配 ============
   .is-mobile 挂在 <html> 上（main.ts 按 UA 判定），不在本组件 scope 内，
   故用 :global()。桌面样式一行未改，其他端表现完全不变。
   注意：整条选择器必须写在 :global(...) 括号内。写成 `:global(html.is-mobile) .bar`
   时 scoped 编译器只保留括号里的部分、丢掉后面的 .bar，规则会退化成
   `html.is-mobile{...}` 直接砸在 <html> 上（曾因此把 display:none 撒到全局）。
   代价是括号内不带 data-v- 属性，故一律用根类名 .reader 限定作用域。 */

/* 阅读器是 fixed inset:0 全屏浮层：顶栏会被状态栏压住、底部会被手势条
   遮住，这里在根容器上让出安全区（padding 收缩内容盒，stage 自动变矮）。 */
:global(html.is-mobile .reader) {
  padding-top: var(--lm-safe-top);
  padding-bottom: var(--lm-safe-bottom);
}

/* 顶栏在 360dp 下塞不下「标题 + 页码 + 一排工具」：让工具整体换到第二行
   （flex:1 1 100% 强制独占一行），工具内部再兜底 wrap。 */
:global(html.is-mobile .reader .bar) {
  flex-wrap: wrap;
  column-gap: 8px;
  row-gap: 2px;
  padding: 6px 8px;
}
:global(html.is-mobile .reader .tools) {
  flex: 1 1 100%;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 4px;
}
/* 触摸目标放大到 44px（M3 建议 ≥48dp，44 是顶栏高度与可点性的折中） */
:global(html.is-mobile .reader .rbtn) {
  width: 44px;
  height: 44px;
}
:global(html.is-mobile .reader .mode-btn) {
  width: 38px;
  height: 38px;
}
/* 面板内的色板需要更大的可点面积 */
:global(html.is-mobile .reader .swatch) {
  width: 28px;
  height: 28px;
}

/* 设置面板改底部弹层：顶栏在移动端会换行、高度不固定，原来的
   top:54px 锚点会与顶栏重叠；锚到底部则与顶栏高度解耦。 */
:global(html.is-mobile .reader .reader-settings) {
  position: fixed;
  top: auto;
  left: 12px;
  right: 12px;
  bottom: calc(12px + var(--lm-safe-bottom));
  width: auto;
  max-height: 70vh;
  overflow-y: auto;
}

/* 目录抽屉是 fixed，不吃根容器的 padding，需自己让出安全区 */
:global(html.is-mobile .reader .toc-panel) {
  padding-top: var(--lm-safe-top);
  padding-bottom: var(--lm-safe-bottom);
}
:global(html.is-mobile .reader .toc-item) {
  padding-top: 13px;
  padding-bottom: 13px;
}

/* 正文区左右留白收窄：桌面的 56px/48px 在 360dp 屏上会吃掉 1/3 宽度 */
:global(html.is-mobile .reader .epub-host) {
  padding: 0 8px;
}
:global(html.is-mobile .reader .pdf-scroll) {
  padding: 12px;
}

/* 悬浮翻页圆钮在窄屏会直接压在正文上（正文左右只剩 20px 留白），
   移动端隐藏，改用两侧点击热区 + 左右滑动手势（onTouchStart/End）。 */
:global(html.is-mobile .reader .nav) {
  display: none;
}
:global(html.is-mobile .reader .tapzone) {
  width: 26%;
}
</style>
