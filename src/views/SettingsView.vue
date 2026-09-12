<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/PageHeader.vue";
import {
  useSettingsStore,
  type PdfReadMode,
  type ThemeMode,
  type PlayerBgMode,
  type LyricFontKey,
  type ShareCodePreference,
  type DesktopLyricsAnimation,
  type DesktopLyricsToolbar,
  type DesktopLyricsDoubleClick,
} from "@/stores/settings";
import { useSkinsStore } from "@/stores/skins";
import { useBangumiCollectStore } from "@/stores/bangumiCollect";
import { useLibraryStore } from "@/stores/library";
import AudioEffectsPanel from "@/components/AudioEffectsPanel.vue";
import { capabilities } from "@/capabilities";
import { formatSize } from "@/utils/format";
import { activeSkinDoc, skinModeLock, skinSafeMode } from "@/utils/skinRuntime";
import { translate } from "@shared/i18n";
import type { FfmpegStatus, SkinEntry } from "@shared/types";

const settings = useSettingsStore();
const library = useLibraryStore();
const router = useRouter();
const bangumiCollect = useBangumiCollectStore();
const bangumiTokenDraft = ref(settings.bangumiToken);

async function connectBangumi() {
  await bangumiCollect.init();
  await bangumiCollect.connect(bangumiTokenDraft.value);
}

function disconnectBangumi() {
  bangumiCollect.disconnect();
  bangumiTokenDraft.value = "";
}

async function openBangumiTokenPage() {
  try {
    await capabilities.openUrl("https://next.bgm.tv/demo/access-token");
  } catch {
    /* 打不开浏览器时用户可手动访问 */
  }
}

const ffmpeg = ref<FfmpegStatus | null>(null);
const checking = ref(false);
const toast = ref("");
const devtoolsEnabled = ref(
  typeof window !== "undefined" && localStorage.getItem("lumiluna-devtools-enabled") === "1",
);

/** 应用版本号：构建期由 vite define 注入（来源 package.json），勿再写死字符串 */
const APP_VERSION = __APP_VERSION__;

function t(key: string) {
  return translate(settings.lang, key);
}

const LYRIC_FONT_KEYS: LyricFontKey[] = ["system", "sans", "serif", "kai", "yuan"];
const LYRICS_ANIMATIONS: DesktopLyricsAnimation[] = ["fade", "slide", "scale", "glow"];

function notify(message: string) {
  toast.value = message;
  window.setTimeout(() => (toast.value = ""), 2400);
}

function toggleDevtools(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked;
  devtoolsEnabled.value = enabled;
  localStorage.setItem("lumiluna-devtools-enabled", enabled ? "1" : "0");
  if (enabled) {
    // 打开后立即打开一次 DevTools，方便定位问题
    void capabilities.openDevtools();
  }
}

onMounted(async () => {
  // 恢复上次手动指定的目录，再查询实际可用状态
  if (settings.ffmpegDir) {
    ffmpeg.value = await capabilities.ffmpegSetPath(settings.ffmpegDir);
  } else {
    ffmpeg.value = await capabilities.ffmpegStatus();
  }
});

async function recheckFfmpeg() {
  checking.value = true;
  try {
    ffmpeg.value = await capabilities.ffmpegSetPath(settings.ffmpegDir || null);
  } finally {
    checking.value = false;
  }
}

async function chooseFfmpegDir() {
  const dir = await capabilities.pickDirectory();
  if (!dir) return;
  settings.ffmpegDir = dir;
  ffmpeg.value = await capabilities.ffmpegSetPath(dir);
  if (!ffmpeg.value.available) {
    notify("该目录下未找到 ffmpeg 可执行文件");
  }
}

async function resetFfmpegDir() {
  settings.ffmpegDir = "";
  ffmpeg.value = await capabilities.ffmpegSetPath(null);
}

/** 弹幕时间轴偏移：UI 单位是秒，内部存毫秒 */
function onDanmakuOffsetChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value);
  if (Number.isFinite(v)) settings.danmakuTimeOffsetMs = Math.round(v * 1000);
}

function setTheme(mode: ThemeMode) {
  settings.applyTheme(mode);
}

// ---- 配色方案（Material You 种子色）----
const COLOR_SEEDS = [
  { key: "blue", hex: "#1A5C9E" },
  { key: "teal", hex: "#00696E" },
  { key: "violet", hex: "#6750A4" },
  { key: "green", hex: "#4C662B" },
  { key: "amber", hex: "#8F4C00" },
  { key: "rose", hex: "#B3261E" },
  { key: "pink", hex: "#8B4A6C" },
] as const;

const isCustomSeed = computed(
  () => !COLOR_SEEDS.some((c) => c.hex.toLowerCase() === settings.seedColor.toLowerCase()),
);

function pickSeed(hex: string) {
  settings.applyColorScheme(hex);
}

function onCustomSeed(event: Event) {
  settings.applyColorScheme((event.target as HTMLInputElement).value);
}

// ---- 皮肤（方案书 §9）----

const skins = useSkinsStore();

/** 皮肤未适配种子色（且非安全模式）时，配色方案行置灰 */
const seedLocked = computed(
  () => !!activeSkinDoc.value && !skinSafeMode.value && !activeSkinDoc.value.manifest.seedColor,
);
/** dark-only / light-only 皮肤锁定浅深切换（安全模式下皮肤不生效、锁随之解除） */
const themeLocked = computed(() => !!skinModeLock.value && !skinSafeMode.value);
const themeLockHint = computed(() =>
  themeLocked.value
    ? t("settings.skinModeLocked").replace(
        "{mode}",
        t(skinModeLock.value === "dark" ? "settings.dark" : "settings.light"),
      )
    : "",
);

function modeIcon(modes: string[]): string {
  if (modes.length === 1) return modes[0] === "dark" ? "dark_mode" : "light_mode";
  return "contrast";
}

function skinCardTitle(s: SkinEntry): string {
  if (s.status === "broken") return `${s.id}：${s.error ?? t("settings.skinBroken")}`;
  const m = s.meta!;
  return `${m.name} · ${m.author} · v${m.version}${m.description ? `\n${m.description}` : ""}`;
}

function onSkinCard(s: SkinEntry) {
  if (s.status === "broken") {
    notify(`${t("settings.skinBroken")}：${s.error ?? s.id}`);
    return;
  }
  void skins.activate(s.id);
}

async function importSkin() {
  const path = await capabilities.pickSkinFile();
  if (path) await skins.importFromFile(path);
}

/** 两步删除：第一次点击进入确认态（3 秒超时回退），第二次执行 */
const confirmDeleteSkin = ref<string | null>(null);
let deleteTimer: number | undefined;
function onDeleteSkin(id: string) {
  if (confirmDeleteSkin.value === id) {
    confirmDeleteSkin.value = null;
    if (deleteTimer) window.clearTimeout(deleteTimer);
    void skins.remove(id);
  } else {
    confirmDeleteSkin.value = id;
    if (deleteTimer) window.clearTimeout(deleteTimer);
    deleteTimer = window.setTimeout(() => (confirmDeleteSkin.value = null), 3000);
  }
}

// ---- WebDAV ----

const davTesting = ref(false);
const davResult = ref<{ ok: boolean; error?: string } | null>(null);
const showDavPass = ref(false);

async function testWebDav() {
  davTesting.value = true;
  davResult.value = null;
  try {
    await capabilities.webdavConfigure(
      settings.webdavUrl,
      settings.webdavUser,
      settings.webdavPass,
    );
    const res = await capabilities.webdavTest();
    if (res.ok) {
      davResult.value = { ok: true };
      notify(res.rootName ? `${t("settings.webdavOk")} · ${res.rootName}` : t("settings.webdavOk"));
    } else {
      davResult.value = { ok: false, error: t("settings.webdavFail") };
    }
  } catch (e) {
    davResult.value = { ok: false, error: String(e) };
    notify(`${t("settings.webdavFail")}：${e}`);
  } finally {
    davTesting.value = false;
  }
}

// ---- 最小体积过滤 ----

const SIZE_PRESETS = [0, 1, 5, 20, 100];
/** 滑块上限 2GB */
const MAX_MB = 2048;

/**
 * 滑块位置与体积之间用对数映射：0-100 的行程覆盖 0MB–2GB，
 * 又能在几 MB 的常用区间给出足够精细的调节粒度（线性映射下
 * 1MB 和 5MB 会挤在同一格里，几乎选不中）。
 */
function posToMb(pos: number): number {
  if (pos <= 0) return 0;
  const mb = Math.pow(MAX_MB, pos / 100);
  return mb < 10 ? Math.round(mb * 10) / 10 : Math.round(mb);
}

function mbToPos(mb: number): number {
  if (mb <= 0) return 0;
  return Math.round((Math.log(mb) / Math.log(MAX_MB)) * 100);
}

const sliderPos = computed(() => mbToPos(settings.minFileSizeMb));

const sizeLabel = computed(() => {
  const mb = settings.minFileSizeMb;
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
});

function onSizeSlider(value: string) {
  applySize(posToMb(Number(value)));
}

function applySize(mb: number) {
  settings.minFileSizeMb = mb;
  // 阈值变了，已缓存的各类型列表和角标都要重取
  library.invalidate();
  void library.refreshCounts();
}

async function addScanDir() {
  const dir = await capabilities.pickDirectory();
  if (dir && !settings.scanDirs.includes(dir)) {
    settings.scanDirs.push(dir);
  }
}

function removeScanDir(index: number) {
  settings.scanDirs.splice(index, 1);
}

function clearScanDirs() {
  settings.scanDirs.splice(0, settings.scanDirs.length);
}

async function clearCache() {
  const freed = await capabilities.clearThumbnailCache();
  library.invalidate();
  notify(`${t("settings.cacheCleared")}${freed ? ` · ${formatSize(freed)}` : ""}`);
}
function resetDesktopLyricsBounds() {
  settings.desktopLyricsBounds = { width: 420, height: 120 };
}

/** 左侧分类导航：一次只显示一个分类，点谁切谁。 */
const settingNav = [
  { title: "通用", items: [{ id: "settings-appearance", label: "外观", icon: "palette" }] },
  {
    title: "媒体",
    items: [
      { id: "settings-library", label: "媒体库", icon: "video_library" },
      { id: "settings-playback", label: "播放", icon: "play_circle" },
    ],
  },
  {
    title: "在线",
    items: [
      { id: "settings-online", label: "在线服务", icon: "public" },
      { id: "settings-sync", label: "同步与网络", icon: "cloud" },
    ],
  },
  { title: "系统", items: [{ id: "settings-other", label: "关于", icon: "info" }] },
];

const activeSection = ref(settingNav[0].items[0].id);

/** 切换分类：右栏只渲染该分类的卡片，并把内容带回顶部。 */
function selectSection(id: string) {
  if (activeSection.value === id) return;
  activeSection.value = id;
  // 不同分类高度差很大，不回到顶部会让短分类停在上一屏的滚动位置
  document.querySelector(".settings-view")?.scrollIntoView({ block: "start" });
}
</script>

<template>
  <div class="settings-view">
    <PageHeader :title="t('nav.settings')" :description="t('navDesc.settings')" />
    <aside class="settings-nav" aria-label="设置分类">
      <template v-for="group in settingNav" :key="group.title">
        <div class="settings-nav-group">{{ group.title }}</div>
        <button
          v-for="item in group.items"
          :key="item.id"
          class="settings-nav-item"
          :class="{ active: activeSection === item.id }"
          type="button"
          @click="selectSection(item.id)"
        >
          <span class="material-symbols-outlined">{{ item.icon }}</span>
          <span class="settings-nav-label">{{ item.label }}</span>
        </button>
      </template>
    </aside>
    <!-- 外观 -->
    <section v-if="activeSection === 'settings-appearance'" id="settings-appearance" class="card">
      <h3>{{ t("settings.appearance") }}</h3>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.theme") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="mode in ['system', 'light', 'dark'] as ThemeMode[]"
            :key="mode"
            class="seg"
            :class="{ active: settings.theme === mode }"
            :disabled="themeLocked"
            @click="setTheme(mode)"
          >
            {{ t("settings." + mode) }}
          </button>
        </div>
      </div>
      <p v-if="themeLockHint" class="hint">{{ themeLockHint }}</p>

      <!-- 皮肤 -->
      <div class="row column">
        <div class="row-label">
          <span>{{ t("settings.skins") }}</span>
        </div>
        <div class="skin-list">
          <div
            class="skin-card"
            :class="{ active: !settings.activeSkin }"
            @click="skins.activate('')"
          >
            <span class="skin-dot" :style="{ '--sw': settings.seedColor }"></span>
            <span class="skin-name">{{ t("settings.skinDefault") }}</span>
          </div>
          <div
            v-for="s in skins.list"
            :key="s.id"
            class="skin-card"
            :class="{
              active: settings.activeSkin === s.id,
              broken: s.status === 'broken',
            }"
            :title="skinCardTitle(s)"
            @click="onSkinCard(s)"
          >
            <span
              class="skin-dot"
              :style="{ '--sw': s.meta?.accent || 'var(--md-sys-color-primary)' }"
            ></span>
            <span class="skin-name">{{ s.meta?.name ?? s.id }}</span>
            <span v-if="s.meta" class="skin-badges">
              <span
                class="fmt"
                :class="`v${s.meta.formatVersion}`"
                :title="t('settings.skinFmtTitle').replace('{v}', String(s.meta.formatVersion))"
                >v{{ s.meta.formatVersion }}</span
              >
              <span
                v-if="s.meta.hasBackground"
                class="material-symbols-outlined mode"
                :title="t('settings.skinHasBackground')"
                >wallpaper</span
              >
              <span
                v-if="s.meta.hasIcons"
                class="material-symbols-outlined mode"
                :title="t('settings.skinHasIcons')"
                >interests</span
              >
              <span class="material-symbols-outlined mode" :title="s.meta.modes.join(' / ')">{{
                modeIcon(s.meta.modes)
              }}</span>
              <span
                v-if="s.meta.seedColor"
                class="material-symbols-outlined seed"
                :title="t('settings.skinSeedAdapted')"
                >colorize</span
              >
              <span class="ver tabular-nums">{{ s.meta.version }}</span>
            </span>
            <button
              class="lm-icon-btn small danger skin-del"
              :class="{ confirming: confirmDeleteSkin === s.id }"
              :title="
                confirmDeleteSkin === s.id
                  ? t('settings.skinDeleteConfirm')
                  : t('settings.skinDelete')
              "
              @click.stop="onDeleteSkin(s.id)"
            >
              <span class="material-symbols-outlined">
                {{ confirmDeleteSkin === s.id ? "check" : "close" }}
              </span>
            </button>
          </div>
          <button class="skin-card import" @click="importSkin">
            <span class="material-symbols-outlined">add</span>
            <span class="skin-name">{{ t("settings.skinImport") }}</span>
          </button>
        </div>
        <div v-if="settings.activeSkin" class="actions skin-actions">
          <button class="lm-btn lm-btn--text" @click="skins.activate('')">
            <span class="material-symbols-outlined">restart_alt</span>
            {{ t("settings.skinRestoreDefault") }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t("settings.skinsHint") }}</p>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.language") }}</span>
        </div>
        <div class="segmented">
          <button
            class="seg"
            :class="{ active: settings.lang === 'zh' }"
            @click="settings.lang = 'zh'"
          >
            简体中文
          </button>
          <button
            class="seg"
            :class="{ active: settings.lang === 'en' }"
            @click="settings.lang = 'en'"
          >
            English
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.colorScheme") }}</span>
        </div>
        <div class="swatches" :class="{ disabled: seedLocked }">
          <button
            v-for="c in COLOR_SEEDS"
            :key="c.key"
            class="swatch"
            :class="{ active: settings.seedColor.toLowerCase() === c.hex.toLowerCase() }"
            :style="{ '--sw': c.hex }"
            :title="t('settings.colorSeed_' + c.key)"
            :aria-label="t('settings.colorSeed_' + c.key)"
            :disabled="seedLocked"
            @click="pickSeed(c.hex)"
          >
            <span class="material-symbols-outlined">check</span>
          </button>
          <label
            class="swatch custom"
            :class="{ active: isCustomSeed }"
            :style="{ '--sw': settings.seedColor }"
            :title="t('settings.colorCustom')"
          >
            <span class="material-symbols-outlined">{{ isCustomSeed ? "check" : "colorize" }}</span>
            <input
              type="color"
              :value="settings.seedColor"
              :disabled="seedLocked"
              @input="onCustomSeed"
            />
          </label>
        </div>
      </div>
      <p class="hint">
        {{ seedLocked ? t("settings.skinSeedLocked") : t("settings.colorSchemeHint") }}
      </p>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.closeAction") }}</span>
        </div>
        <div class="segmented">
          <button
            class="seg"
            :class="{ active: settings.closeToTray }"
            @click="settings.closeToTray = true"
          >
            {{ t("settings.closeAction_tray") }}
          </button>
          <button
            class="seg"
            :class="{ active: !settings.closeToTray }"
            @click="settings.closeToTray = false"
          >
            {{ t("settings.closeAction_quit") }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t("settings.closeToTrayHint") }}</p>
    </section>

    <!-- 扫描目录 -->
    <section v-if="activeSection === 'settings-library'" id="settings-library" class="card">
      <h3>{{ t("settings.scanDirs") }}</h3>
      <p class="hint">{{ t("settings.scanDirsHint") }}</p>

      <div v-if="settings.scanDirs.length" class="dir-list">
        <div v-for="(dir, i) in settings.scanDirs" :key="dir" class="dir-item">
          <span class="material-symbols-outlined">folder</span>
          <span class="dir-path" :title="dir">{{ dir }}</span>
          <button class="lm-icon-btn small danger" @click="removeScanDir(i)">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      </div>
      <div v-else class="notice">{{ t("settings.globalScanHint") }}</div>

      <div class="actions">
        <button class="lm-btn lm-btn--tonal" @click="addScanDir">
          <span class="material-symbols-outlined">create_new_folder</span>
          {{ t("settings.addScanDir") }}
        </button>
        <button v-if="settings.scanDirs.length" class="lm-btn lm-btn--text" @click="clearScanDirs">
          {{ t("settings.clearScanDirs") }}
        </button>
      </div>
    </section>

    <!-- 体积过滤 -->
    <section v-if="activeSection === 'settings-library'" class="card">
      <h3>{{ t("settings.minSize") }}</h3>
      <p class="hint">{{ t("settings.minSizeHint") }}</p>
      <div class="row">
        <input
          type="range"
          min="0"
          max="100"
          step="1"
          :value="sliderPos"
          @input="onSizeSlider(($event.target as HTMLInputElement).value)"
        />
        <span class="value tabular-nums">
          {{ settings.minFileSizeMb > 0 ? sizeLabel : t("settings.minSizeOff") }}
        </span>
      </div>
      <div class="presets">
        <button
          v-for="p in SIZE_PRESETS"
          :key="p"
          class="chip"
          :class="{ active: settings.minFileSizeMb === p }"
          @click="applySize(p)"
        >
          {{ p === 0 ? t("settings.minSizeOff") : `${p} MB` }}
        </button>
      </div>
    </section>

    <!-- 阅读 -->
    <section v-if="activeSection === 'settings-library'" class="card">
      <h3>{{ t("settings.reading") }}</h3>
      <p class="hint">{{ t("settings.pdfModeHint") }}</p>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.pdfMode") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in ['single', 'dual', 'scroll'] as PdfReadMode[]"
            :key="m"
            class="seg"
            :class="{ active: settings.pdfReadMode === m }"
            @click="settings.pdfReadMode = m"
          >
            {{ t("settings.pdfMode_" + m) }}
          </button>
        </div>
      </div>
    </section>

    <!-- FFmpeg -->
    <section v-if="activeSection === 'settings-playback'" id="settings-playback" class="card">
      <h3>{{ t("settings.ffmpeg") }}</h3>
      <p class="hint">{{ t("settings.ffmpegHint") }}</p>

      <div class="status" :class="ffmpeg?.available ? 'ok' : 'warn'">
        <span class="material-symbols-outlined">
          {{ ffmpeg?.available ? "check_circle" : "error" }}
        </span>
        <div class="status-text">
          <strong>
            {{ ffmpeg?.available ? t("settings.ffmpegDetected") : t("settings.ffmpegMissing") }}
          </strong>
          <span v-if="ffmpeg?.available" class="mono">{{ ffmpeg.ffmpegPath }}</span>
          <span v-if="ffmpeg?.version" class="version">{{ ffmpeg.version }}</span>
          <span v-if="ffmpeg?.available" class="source">
            {{
              ffmpeg.source === "override"
                ? t("settings.ffmpegFromOverride")
                : t("settings.ffmpegFromPath")
            }}
          </span>
        </div>
      </div>

      <div v-if="settings.ffmpegDir" class="dir-item override">
        <span class="material-symbols-outlined">tune</span>
        <span class="dir-path" :title="settings.ffmpegDir">{{ settings.ffmpegDir }}</span>
      </div>

      <div class="actions">
        <button class="lm-btn lm-btn--tonal" @click="chooseFfmpegDir">
          <span class="material-symbols-outlined">folder_open</span>
          {{ t("settings.ffmpegChoose") }}
        </button>
        <button class="lm-btn lm-btn--outlined" :disabled="checking" @click="recheckFfmpeg">
          <span class="material-symbols-outlined">refresh</span>
          {{ t("settings.ffmpegRecheck") }}
        </button>
        <button v-if="settings.ffmpegDir" class="lm-btn lm-btn--text" @click="resetFfmpegDir">
          {{ t("settings.ffmpegReset") }}
        </button>
        <button
          v-if="!ffmpeg?.available"
          class="lm-btn lm-btn--text"
          @click="capabilities.openFfmpegDownloadPage()"
        >
          <span class="material-symbols-outlined">download</span>
          {{ t("settings.ffmpegDownload") }}
        </button>
      </div>
    </section>

    <!-- 歌词 -->
    <section v-if="activeSection === 'settings-playback'" class="card">
      <h3>{{ t("settings.lyrics") }}</h3>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.wordLyrics") }}</span>
        <input v-model="settings.wordLyrics" type="checkbox" />
      </label>
      <p class="hint">{{ t("settings.wordLyricsHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.preciseLyrics") }}</span>
        <input v-model="settings.preciseLyrics" type="checkbox" />
      </label>
      <p class="hint">{{ t("settings.preciseLyricsHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.detectInstrumental") }}</span>
        <input v-model="settings.detectInstrumental" type="checkbox" />
      </label>
      <p class="hint">{{ t("settings.detectInstrumentalHint") }}</p>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricFont") }}</span>
        </div>
        <div class="presets inline">
          <button
            v-for="k in LYRIC_FONT_KEYS"
            :key="k"
            class="chip"
            :class="{ active: settings.lyricFont === k }"
            @click="settings.lyricFont = k"
          >
            {{ t("settings.lyricFont_" + k) }}
          </button>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricFontSize") }}</span>
        </div>
        <input v-model.number="settings.lyricFontSize" type="range" min="16" max="48" />
        <span class="value tabular-nums">{{ settings.lyricFontSize }}px</span>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricLineHeight") }}</span>
        </div>
        <input
          v-model.number="settings.lyricLineHeight"
          type="range"
          min="1.6"
          max="3.2"
          step="0.1"
        />
        <span class="value tabular-nums">{{ settings.lyricLineHeight.toFixed(1) }}</span>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricLineGap") }}</span>
        </div>
        <input v-model.number="settings.lyricLineGap" type="range" min="0" max="64" step="1" />
        <span class="value tabular-nums">{{ settings.lyricLineGap }}px</span>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricTranslationSize") }}</span>
        </div>
        <input
          v-model.number="settings.lyricTranslationSize"
          type="range"
          min="40"
          max="120"
          step="5"
        />
        <span class="value tabular-nums">{{ settings.lyricTranslationSize }}%</span>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.lyricTranslationGap") }}</span>
        </div>
        <input
          v-model.number="settings.lyricTranslationGap"
          type="range"
          min="0"
          max="24"
          step="1"
        />
        <span class="value tabular-nums">{{ settings.lyricTranslationGap }}px</span>
      </div>
    </section>
    <!-- 桌面歌词 -->
    <section v-if="activeSection === 'settings-playback'" class="card">
      <h3>{{ t("settings.desktopLyrics") }}</h3>
      <p class="hint">{{ t("settings.desktopLyricsHint") }}</p>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsEnable") }}</span>
        <input v-model="settings.desktopLyricsEnabled" type="checkbox" />
      </label>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsShowNext") }}</span>
        <input v-model="settings.desktopLyricsShowNext" type="checkbox" />
      </label>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsShowTranslation") }}</span>
        <input v-model="settings.desktopLyricsShowTranslation" type="checkbox" />
      </label>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.desktopLyricsToolbar") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in ['click', 'always'] as DesktopLyricsToolbar[]"
            :key="m"
            class="seg"
            :class="{ active: settings.desktopLyricsToolbar === m }"
            @click="settings.desktopLyricsToolbar = m"
          >
            {{ t("settings.desktopLyricsToolbar_" + m) }}
          </button>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.desktopLyricsDoubleClick") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in ['none', 'toggle'] as DesktopLyricsDoubleClick[]"
            :key="m"
            class="seg"
            :class="{ active: settings.desktopLyricsDoubleClick === m }"
            @click="settings.desktopLyricsDoubleClick = m"
          >
            {{ t("settings.desktopLyricsDoubleClick_" + m) }}
          </button>
        </div>
      </div>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.desktopLyricsFontSize") }}</span>
        </div>
        <input
          v-model.number="settings.desktopLyricsFontSize"
          type="range"
          min="16"
          max="64"
          step="1"
        />
        <span class="value tabular-nums">{{ settings.desktopLyricsFontSize }}px</span>
      </div>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.desktopLyricsOpacity") }}</span>
        </div>
        <input
          v-model.number="settings.desktopLyricsOpacity"
          type="range"
          min="30"
          max="100"
          step="5"
        />
        <span class="value tabular-nums">{{ settings.desktopLyricsOpacity }}%</span>
      </div>

      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.desktopLyricsAnimation") }}</span>
        </div>
        <div class="presets inline">
          <button
            v-for="k in LYRICS_ANIMATIONS"
            :key="k"
            class="chip"
            :class="{ active: settings.desktopLyricsAnimation === k }"
            @click="settings.desktopLyricsAnimation = k"
          >
            {{ t("settings.desktopLyricsAnim_" + k) }}
          </button>
        </div>
      </div>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsLocked") }}</span>
        <input v-model="settings.desktopLyricsLocked" type="checkbox" />
      </label>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsClickThrough") }}</span>
        <input v-model="settings.desktopLyricsClickThrough" type="checkbox" />
      </label>
      <p class="hint">{{ t("settings.desktopLyricsClickThroughHint") }}</p>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.desktopLyricsAlwaysOnTop") }}</span>
        <input v-model="settings.desktopLyricsAlwaysOnTop" type="checkbox" />
      </label>

      <div class="actions">
        <button class="lm-btn lm-btn--outlined" @click="resetDesktopLyricsBounds">
          {{ t("settings.desktopLyricsResetPos") }}
        </button>
      </div>
    </section>

    <!-- 播放器 -->
    <section v-if="activeSection === 'settings-playback'" class="card">
      <h3>{{ t("settings.playback") }}</h3>
      <p class="hint">{{ t("settings.playerBgHint") }}</p>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.playerBg") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in ['animated', 'image', 'off'] as PlayerBgMode[]"
            :key="m"
            class="seg"
            :class="{ active: settings.playerBg === m }"
            @click="settings.playerBg = m"
          >
            {{ t("settings.playerBg_" + m) }}
          </button>
        </div>
      </div>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.musicViewMode") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="m in ['grid', 'list'] as const"
            :key="m"
            class="seg"
            :class="{ active: settings.musicViewMode === m }"
            @click="settings.musicViewMode = m"
          >
            {{ t("settings.musicViewMode_" + m) }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t("player.hotkeysHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.lyricBlur") }}</span>
        <input v-model="settings.lyricBlur" type="checkbox" />
      </label>
    </section>

    <!-- 音效 -->
    <section v-if="activeSection === 'settings-playback'" class="card">
      <h3>{{ t("settings.audioEffects") }}</h3>
      <p class="hint">{{ t("settings.audioEffectsHint") }}</p>
      <div class="row">
        <div class="row-label">
          <span>{{ t("settings.shareCodePreference") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="mode in ['chinese', 'original', 'both'] as ShareCodePreference[]"
            :key="mode"
            class="seg"
            :class="{ active: settings.shareCodePreference === mode }"
            @click="settings.shareCodePreference = mode"
          >
            {{ t("settings.shareCodePreference_" + mode) }}
          </button>
        </div>
      </div>
      <p class="hint">{{ t("settings.shareCodePreferenceHint") }}</p>
      <AudioEffectsPanel />
    </section>

    <!-- 实验性：在线音乐 -->
    <section v-if="activeSection === 'settings-online'" id="settings-online" class="card">
      <h3>{{ t("settings.online") }}</h3>
      <p class="hint">{{ t("settings.onlineHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.onlineEnable") }}</span>
        <input v-model="settings.enableOnlineMusic" type="checkbox" />
      </label>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.neteaseEnable") }}</span>
        <input v-model="settings.neteaseEnabled" type="checkbox" />
      </label>
      <p class="hint">{{ t("settings.neteaseHint") }}</p>
      <div v-if="settings.enableOnlineMusic" class="row">
        <div class="row-label">
          <span>{{ t("settings.onlineServer") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="s in ['netease'] as const"
            :key="s"
            class="seg"
            :class="{ active: settings.musicServer === s }"
            @click="settings.musicServer = s"
          >
            {{ t("settings.onlineServer_" + s) }}
          </button>
        </div>
      </div>
    </section>

    <!-- 在线小说 -->
    <section v-if="activeSection === 'settings-online'" class="card">
      <h3>{{ t("settings.onlineNovel") }}</h3>
      <p class="hint">{{ t("settings.onlineNovelHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.onlineNovelEnable") }}</span>
        <input v-model="settings.onlineNovelEnabled" type="checkbox" />
      </label>
      <div v-if="settings.onlineNovelEnabled" class="row">
        <div class="row-label">
          <span>{{ t("settings.wenku8Node") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="n in ['cc', 'net'] as const"
            :key="n"
            class="seg"
            :class="{ active: settings.wenku8Node === n }"
            @click="settings.wenku8Node = n"
          >
            {{ t("settings.wenku8Node_" + n) }}
          </button>
        </div>
      </div>
      <div v-if="settings.onlineNovelEnabled" class="row">
        <div class="row-label">
          <span>{{ t("settings.novelCharset") }}</span>
        </div>
        <div class="segmented">
          <button
            v-for="c in ['gbk', 'big5'] as const"
            :key="c"
            class="seg"
            :class="{ active: settings.novelCharset === c }"
            @click="settings.novelCharset = c"
          >
            {{ t("settings.novelCharset_" + c) }}
          </button>
        </div>
      </div>
    </section>

    <!-- 在线番剧 -->
    <section v-if="activeSection === 'settings-online'" class="card">
      <h3>{{ t("settings.onlineAnime") }}</h3>
      <p class="hint">{{ t("settings.onlineAnimeHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.onlineAnimeEnable") }}</span>
        <input v-model="settings.onlineAnimeEnabled" type="checkbox" />
      </label>
      <template v-if="settings.onlineAnimeEnabled">
        <p class="hint">{{ t("settings.bangumiHint") }}</p>
        <div class="dav-form">
          <div class="field">
            <label>{{ t("settings.bangumiTokenLabel") }}</label>
            <div class="token-line">
              <input
                v-model="bangumiTokenDraft"
                type="password"
                spellcheck="false"
                autocomplete="off"
                :placeholder="t('settings.bangumiTokenPlaceholder')"
              />
              <button
                class="lm-btn lm-btn--filled"
                :disabled="bangumiCollect.authState === 'checking' || !bangumiTokenDraft.trim()"
                @click="connectBangumi"
              >
                {{ t("settings.bangumiConnect") }}
              </button>
              <button
                v-if="bangumiCollect.authorized"
                class="lm-btn lm-btn--text"
                @click="disconnectBangumi"
              >
                {{ t("settings.bangumiDisconnect") }}
              </button>
            </div>
            <p v-if="bangumiCollect.authorized" class="token-state ok">
              {{
                t("settings.bangumiConnected").replace(
                  "{u}",
                  bangumiCollect.user?.nickname || settings.bangumiUsername,
                )
              }}
            </p>
            <p v-else-if="bangumiCollect.authError" class="token-state err">
              {{ bangumiCollect.authError }}
            </p>
            <p class="hint">
              {{ t("settings.bangumiTokenHelp") }}
              <button class="link-inline" @click="openBangumiTokenPage">
                {{ t("settings.bangumiTokenLink") }}
              </button>
            </p>
          </div>
        </div>
      </template>
    </section>

    <!-- 在线 Pixiv -->
    <section v-if="activeSection === 'settings-online'" class="card">
      <h3>{{ t("settings.onlinePixivEnabled") }}</h3>
      <p class="hint">{{ t("settings.onlinePixivHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.onlinePixivEnabled") }}</span>
        <input v-model="settings.onlinePixivEnabled" type="checkbox" />
      </label>
      <template v-if="settings.onlinePixivEnabled">
        <div class="row">
          <div class="row-label">
            <span>{{ t("settings.pixivQuality") }}</span>
          </div>
          <div class="segmented">
            <button
              v-for="q in ['squareMedium', 'medium', 'large', 'original'] as const"
              :key="q"
              class="seg"
              :class="{ active: settings.pixivImageQuality === q }"
              @click="settings.pixivImageQuality = q"
            >
              {{ t("settings.pixivQuality_" + q) }}
            </button>
          </div>
        </div>
        <p class="hint">{{ t("settings.pixivRefreshTokenHint") }}</p>
        <div class="dav-form">
          <div class="field">
            <label>{{ t("settings.pixivRefreshTokenLabel") }}</label>
            <input
              v-model="settings.pixivRefreshToken"
              type="password"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
        </div>
      </template>
    </section>

    <!-- DanDanPlay 弹幕 -->
    <section v-if="activeSection === 'settings-online' && settings.onlineAnimeEnabled" class="card">
      <h3>{{ t("settings.danmaku") }}</h3>
      <p class="hint">{{ t("settings.danmakuHint") }}</p>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.danmakuEnable") }}</span>
        <input v-model="settings.danmakuEnabled" type="checkbox" />
      </label>
      <template v-if="settings.danmakuEnabled">
        <div class="dav-form">
          <div class="field">
            <label>{{ t("settings.danmakuAppId") }}</label>
            <input
              v-model="settings.dandanAppId"
              type="text"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
          <div class="field">
            <label>{{ t("settings.danmakuAppSecret") }}</label>
            <input
              v-model="settings.dandanAppSecret"
              type="password"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
        </div>
        <div class="dav-grid">
          <label class="field">
            <span>{{ t("settings.danmakuOpacity") }} {{ settings.danmakuOpacity }}%</span>
            <input
              v-model.number="settings.danmakuOpacity"
              type="range"
              min="10"
              max="100"
              step="5"
            />
          </label>
          <label class="field">
            <span>{{ t("settings.danmakuFontSize") }} {{ settings.danmakuFontSize }}px</span>
            <input
              v-model.number="settings.danmakuFontSize"
              type="range"
              min="12"
              max="48"
              step="1"
            />
          </label>
          <label class="field">
            <span>{{ t("settings.danmakuArea") }} {{ settings.danmakuArea }}%</span>
            <input v-model.number="settings.danmakuArea" type="range" min="20" max="100" step="5" />
          </label>
          <label class="field">
            <span>{{ t("settings.danmakuSpeed") }} {{ settings.danmakuSpeed }}</span>
            <input v-model.number="settings.danmakuSpeed" type="range" min="1" max="10" step="1" />
          </label>
        </div>
        <div class="dav-grid">
          <label class="field">
            <span>{{ t("settings.danmakuTimeOffset") }}</span>
            <input
              :value="(settings.danmakuTimeOffsetMs / 1000).toFixed(1)"
              type="number"
              step="0.1"
              min="-30"
              max="30"
              @change="onDanmakuOffsetChange"
            />
          </label>
          <label class="row switch-row">
            <span class="row-label">{{ t("settings.danmakuAntiOverlap") }}</span>
            <input v-model="settings.danmakuAntiOverlap" type="checkbox" />
          </label>
        </div>
      </template>
    </section>

    <!-- WebDAV -->
    <section v-if="activeSection === 'settings-sync'" id="settings-sync" class="card">
      <h3>{{ t("settings.webdav") }}</h3>
      <p class="hint">{{ t("settings.webdavHint") }}</p>

      <label class="row switch-row">
        <span class="row-label">{{ t("settings.webdavEnable") }}</span>
        <input v-model="settings.webdavEnabled" type="checkbox" />
      </label>

      <div v-if="settings.webdavEnabled" class="dav-form">
        <div class="field">
          <label>{{ t("settings.webdavUrl") }}</label>
          <input
            v-model="settings.webdavUrl"
            type="url"
            :placeholder="t('settings.webdavUrlPlaceholder')"
            spellcheck="false"
            autocomplete="off"
          />
        </div>
        <div class="dav-grid">
          <div class="field">
            <label>{{ t("settings.webdavUser") }}</label>
            <input
              v-model="settings.webdavUser"
              type="text"
              spellcheck="false"
              autocomplete="off"
            />
          </div>
          <div class="field">
            <label>{{ t("settings.webdavPass") }}</label>
            <div class="pass-wrap">
              <input
                v-model="settings.webdavPass"
                :type="showDavPass ? 'text' : 'password'"
                spellcheck="false"
                autocomplete="new-password"
              />
              <button
                class="lm-icon-btn small"
                :title="showDavPass ? 'hide' : 'show'"
                @click="showDavPass = !showDavPass"
              >
                <span class="material-symbols-outlined">
                  {{ showDavPass ? "visibility_off" : "visibility" }}
                </span>
              </button>
            </div>
          </div>
        </div>

        <div v-if="davResult" class="status" :class="davResult.ok ? 'ok' : 'warn'">
          <span class="material-symbols-outlined">
            {{ davResult.ok ? "check_circle" : "error" }}
          </span>
          <div class="status-text">
            <strong>
              {{ davResult.ok ? t("settings.webdavOk") : t("settings.webdavFail") }}
            </strong>
            <span v-if="!davResult.ok && davResult.error">{{ davResult.error }}</span>
          </div>
        </div>

        <div class="actions">
          <button class="lm-btn lm-btn--tonal" :disabled="davTesting" @click="testWebDav">
            <span class="material-symbols-outlined">cloud_sync</span>
            {{ davTesting ? t("settings.webdavTesting") : t("settings.webdavTest") }}
          </button>
          <button class="lm-btn lm-btn--outlined" @click="router.push('/webdav')">
            <span class="material-symbols-outlined">cloud</span>
            {{ t("settings.webdavOpen") }}
          </button>
        </div>
      </div>
    </section>

    <!-- 关于 -->
    <section v-if="activeSection === 'settings-other'" id="settings-other" class="card">
      <h3>{{ t("settings.about") }}</h3>
      <div class="row">
        <span class="row-label">{{ t("settings.version") }}</span>
        <span class="value">{{ APP_VERSION }}</span>
      </div>
      <label class="row switch-row">
        <span class="row-label">{{ t("settings.devtools") }}</span>
        <input type="checkbox" :checked="devtoolsEnabled" @change="toggleDevtools" />
      </label>
      <p class="hint">{{ t("settings.devtoolsHint") }}</p>
      <div class="actions">
        <button class="lm-btn lm-btn--outlined" @click="clearCache">
          <span class="material-symbols-outlined">cleaning_services</span>
          {{ t("settings.clearCache") }}
        </button>
      </div>
    </section>

    <transition name="toast">
      <div v-if="toast" class="toast">{{ toast }}</div>
    </transition>
  </div>
</template>

<style scoped>
.settings-view {
  display: grid;
  grid-template-columns: 180px minmax(0, 800px);
  align-items: start;
  gap: 0 24px;
  max-width: 1040px;
  margin: 0 auto;
  padding-bottom: 40px;
}
/* PageHeader 的根类名是 .page-head（不是 .page-header）——
   之前写错导致标题没占满整行、被挤进 180px 左栏，整页错位。 */
.settings-view :deep(.page-head) {
  grid-column: 1 / -1;
}
.settings-nav {
  grid-column: 1;
  position: sticky;
  top: 12px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 0;
}
.settings-nav-group {
  padding: 8px 12px 2px;
  color: var(--md-sys-color-on-surface-variant);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.4px;
  opacity: 0.8;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  text-align: left;
  cursor: pointer;
  transition:
    background-color 160ms var(--md-sys-motion-spring-effects-fast),
    color 160ms var(--md-sys-motion-spring-effects-fast);
}
.settings-nav-item .material-symbols-outlined {
  font-size: 20px;
}
.settings-nav-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.settings-nav-item:hover {
  background: var(--md-sys-color-surface-container-high);
  color: var(--md-sys-color-on-surface);
}
.settings-nav-item.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 500;
}

.card {
  grid-column: 2;
  scroll-margin-top: 18px;
  background: var(--md-sys-color-surface-container-low);
  border-radius: var(--lm-shape-card);
  padding: 20px 22px;
  margin-bottom: 16px;
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
  animation: lm-rise 340ms var(--md-sys-motion-spring-spatial) both;
}
.card h3 {
  margin-bottom: 6px;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: var(--md-sys-typescale-title-medium-weight);
}

.token-line {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.token-line input {
  flex: 1;
  min-width: 220px;
  height: 36px;
  padding: 0 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  outline: none;
}
.token-line input:focus {
  border-color: var(--md-sys-color-primary);
}
.token-line .material-symbols-outlined {
  font-size: 18px;
}
.token-state {
  margin: 6px 0 0;
  font-size: var(--md-sys-typescale-body-small-size);
}
.token-state.ok {
  color: var(--md-sys-color-primary);
}
.token-state.err {
  color: var(--md-sys-color-error);
}
.link-inline {
  border: none;
  background: transparent;
  color: var(--md-sys-color-primary);
  font-family: inherit;
  font-size: inherit;
  text-decoration: underline;
  cursor: pointer;
  padding: 0;
}
.hint {
  margin-bottom: 16px;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.6;
  color: var(--md-sys-color-on-surface-variant);
}

.row {
  display: flex;
  align-items: center;
  gap: 14px;
  min-height: 48px;
}
.row-label {
  flex: 1;
  font-size: var(--md-sys-typescale-body-medium-size);
}
.row input[type="range"] {
  flex: 2;
  accent-color: var(--md-sys-color-primary);
}
.value {
  min-width: 52px;
  text-align: right;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}

/* 开关视觉统一在 src/tokens/theme.css 的「M3 Switch」全局样式里，此处只管点击区域 */
.switch-row {
  cursor: pointer;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 2px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--lm-shape-button);
}
.seg {
  border: none;
  background: transparent;
  padding: 7px 16px;
  border-radius: var(--lm-shape-button);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  color: var(--md-sys-color-on-surface-variant);
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.seg:hover {
  color: var(--md-sys-color-on-surface);
}
.seg.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  font-weight: 500;
}

/* 配色方案色板 */
.swatches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  justify-content: flex-end;
}
.swatch {
  position: relative;
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: var(--sw, var(--md-sys-color-primary));
  color: #fff;
  cursor: pointer;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
  transition:
    transform 160ms var(--md-sys-motion-spring),
    box-shadow 160ms var(--md-sys-motion-spring-effects-fast);
}
.swatch:hover {
  transform: scale(1.12);
}
.swatch:active {
  transform: scale(0.94);
}
.swatch .material-symbols-outlined {
  font-size: 18px;
  opacity: 0;
  transform: scale(0.4);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.35);
  transition:
    opacity 160ms var(--md-sys-motion-spring-effects-fast),
    transform 160ms var(--md-sys-motion-spring);
}
.swatch.active {
  box-shadow:
    0 0 0 2px var(--md-sys-color-surface),
    0 0 0 4px var(--sw, var(--md-sys-color-primary));
}
.swatch.active .material-symbols-outlined {
  opacity: 1;
  transform: scale(1);
}
/* 自定义色：原生取色器铺满圆点但透明，仅保留点击唤起 */
.swatch.custom .material-symbols-outlined {
  opacity: 1;
  transform: scale(1);
}
.swatch.custom input[type="color"] {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  opacity: 0;
  cursor: pointer;
}
/* 种子色被皮肤门控时整组置灰 */
.swatches.disabled {
  opacity: 0.4;
  pointer-events: none;
}

/* ---- 皮肤卡片列表 ---- */
.row.column {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
}
.skin-list {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.skin-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 128px;
  max-width: 210px;
  padding: 10px 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  cursor: pointer;
  transition:
    background var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast),
    transform 160ms var(--md-sys-motion-spring),
    box-shadow 160ms var(--md-sys-motion-spring-effects-fast);
}
.skin-card:hover {
  background: var(--md-sys-color-surface-container-high);
  transform: translateY(-1px);
}
.skin-card.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  box-shadow: 0 0 0 2px var(--md-sys-color-primary);
}
.skin-card.broken {
  opacity: 0.55;
  cursor: not-allowed;
  border: 1px dashed var(--md-sys-color-outline);
}
.skin-card.import {
  border: 1px dashed var(--md-sys-color-outline-variant);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
}
.skin-card.import:hover {
  color: var(--md-sys-color-primary);
  border-color: var(--md-sys-color-primary);
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}
.skin-card.import .material-symbols-outlined {
  font-size: 20px;
}
.skin-dot {
  flex: none;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--sw, var(--md-sys-color-primary));
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.skin-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--md-sys-typescale-body-medium-size);
  font-weight: 500;
}
.skin-badges {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: auto;
  opacity: 0.75;
}
.skin-badges .material-symbols-outlined {
  font-size: 14px;
}
.skin-badges .fmt {
  padding: 1px 5px;
  border-radius: 4px;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.4;
  letter-spacing: 0.3px;
}
.skin-badges .fmt.v2 {
  background: var(--md-sys-color-primary);
  color: var(--md-sys-color-on-primary);
}
.skin-badges .fmt.v1 {
  background: var(--md-sys-color-surface-container-highest);
  color: var(--md-sys-color-on-surface-variant);
}
.skin-badges .ver {
  font-size: 10px;
  color: var(--md-sys-color-on-surface-variant);
}
.skin-del {
  width: 24px;
  height: 24px;
  opacity: 0;
}
.skin-card:hover .skin-del {
  opacity: 1;
}
.skin-del.confirming {
  opacity: 1;
  color: var(--md-sys-color-error);
}
.skin-actions {
  margin-top: 0;
}

.dir-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-bottom: 12px;
}
.dir-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 8px 12px;
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-medium);
}
.dir-item > .material-symbols-outlined {
  font-size: 19px;
  color: var(--md-sys-color-on-surface-variant);
}
.dir-item.override {
  margin-bottom: 12px;
}
.dir-path {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  direction: rtl;
  text-align: left;
}
.lm-icon-btn.small {
  width: 30px;
  height: 30px;
}
.lm-icon-btn.small .material-symbols-outlined {
  font-size: 17px;
}
.lm-icon-btn.danger:hover {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-error);
}

.notice {
  padding: 12px 14px;
  margin-bottom: 12px;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
  background: var(--md-sys-color-surface-container-high);
  border-radius: var(--md-sys-shape-corner-medium);
}

.status {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  margin-bottom: 12px;
  border-radius: var(--md-sys-shape-corner-medium);
}
.status.ok {
  background: color-mix(in srgb, var(--md-sys-color-primary) 12%, transparent);
  color: var(--md-sys-color-on-surface);
}
.status.warn {
  background: var(--md-sys-color-error-container);
  color: var(--md-sys-color-on-error-container);
}
.status > .material-symbols-outlined {
  font-size: 22px;
}
.status-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-small-size);
}
.status-text .mono {
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  word-break: break-all;
  opacity: 0.85;
}
.status-text .version,
.status-text .source {
  opacity: 0.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
}
.actions .material-symbols-outlined {
  font-size: 18px;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}
/* 放在 .row 里的选择芯片：去掉上边距，与标签对齐 */
.presets.inline {
  margin-top: 0;
}
.presets.inline .chip {
  height: 30px;
  padding: 0 12px;
}
.presets .chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-small);
  background: transparent;
  color: var(--md-sys-color-on-surface-variant);
  font-family: inherit;
  font-size: var(--md-sys-typescale-label-large-size);
  cursor: pointer;
  transition: all var(--md-sys-motion-duration-short) var(--md-sys-motion-spring-effects-fast);
}
.presets .chip:hover {
  background: var(--md-sys-color-surface-container-high);
}
.presets .chip.active {
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
  border-color: transparent;
  font-weight: 500;
}

.toast {
  position: fixed;
  left: 50%;
  bottom: 90px;
  transform: translateX(-50%);
  padding: 12px 20px;
  border-radius: var(--md-sys-shape-corner-small);
  background: var(--md-sys-color-inverse-surface);
  color: var(--md-sys-color-inverse-on-surface);
  box-shadow: var(--md-elevation-3);
  font-size: var(--md-sys-typescale-body-medium-size);
  z-index: 100;
}
.toast-enter-active,
.toast-leave-active {
  transition: all 240ms var(--md-sys-motion-spring-spatial);
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}

@media (max-width: 760px) {
  .settings-view {
    display: block;
    max-width: 760px;
  }
  .settings-nav {
    position: static;
    flex-direction: row;
    overflow-x: auto;
    margin-bottom: 12px;
    padding: 0 0 4px;
  }
  .settings-nav-group {
    display: none;
  }
  .settings-nav-item {
    flex: 0 0 auto;
    white-space: nowrap;
  }
  .card {
    scroll-margin-top: 12px;
  }
}
</style>
