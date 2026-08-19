<script setup lang="ts">
/**
 * 在线小说阅读器（Wenku8）：按章节拉取正文，支持上一章/下一章/目录，
 * 复用阅读设置（主题/字体/字号/行距/段距），保存进度并做章节级阅读计时。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import type { NovelChapter, NovelContent, NovelVolume } from "@shared/types";

const props = defineProps<{
  aid: string;
  title: string;
  initialCid?: string;
  initialChapterTitle?: string;
}>();

const emit = defineEmits<{ (e: "close"): void }>();

const settings = useSettingsStore();
const t = (key: string) => translate(settings.lang, key);

const volumes = ref<NovelVolume[]>([]);
const chapters = ref<NovelChapter[]>([]);
const currentIndex = ref(0);
const currentCid = ref("");
const currentTitle = ref("");
const content = ref<NovelContent | null>(null);
const loading = ref(true);
const error = ref("");
const showToc = ref(false);

// 章节级计时
let sessionId = "";
let sessionStart = 0;
let currentChapterKey = "";

const themeMap: Record<string, { bg: string; fg: string }> = {
  dark: { bg: "#17171a", fg: "#e6e6e8" },
  light: { bg: "#f6f6f2", fg: "#33343a" },
  sepia: { bg: "#ece4d6", fg: "#5a4a3a" },
  green: { bg: "#d6e3d2", fg: "#35433a" },
};
const theme = computed(() => themeMap[settings.readerTheme] ?? themeMap.dark);

const fontMap: Record<string, string> = {
  system: '"SarasaGothicSC-Regular","Microsoft YaHei",system-ui,sans-serif',
  serif: 'Georgia,"Songti SC","SimSun",serif',
  sans: '"Microsoft YaHei","Hiragino Sans GB",sans-serif',
  kai: '"KaiTi","STKaiti",cursive',
  yuan: '"Yuanti SC","YouYuan","Microsoft JhengHei UI",sans-serif',
};
const fontFamily = computed(() => fontMap[settings.readerFont] ?? fontMap.system);

function flattenChapters() {
  const list: NovelChapter[] = [];
  for (const v of volumes.value) list.push(...v.chapters);
  chapters.value = list;
}

function flushSession() {
  if (!sessionId || !sessionStart || !currentChapterKey) return;
  const endedAt = Date.now();
  const durationMs = Math.max(0, endedAt - sessionStart);
  if (durationMs >= 1000) {
    void capabilities.novelReadSessionEnd({
      id: sessionId,
      bookId: props.aid,
      source: "online",
      title: props.title,
      chapterKey: currentChapterKey,
      chapterTitle: currentTitle.value,
      startedAt: sessionStart,
      endedAt,
      durationMs,
      completed: false,
    });
  }
  sessionId = "";
  sessionStart = 0;
  currentChapterKey = "";
}

function beginSession() {
  flushSession();
  sessionId = crypto.randomUUID();
  sessionStart = Date.now();
  currentChapterKey = currentCid.value;
}

async function loadChapter(index: number) {
  if (index < 0 || index >= chapters.value.length) return;
  currentIndex.value = index;
  const ch = chapters.value[index];
  currentCid.value = ch.cid;
  currentTitle.value = ch.title;
  loading.value = true;
  error.value = "";
  try {
    content.value = await capabilities.novelContent(
      settings.wenku8Node,
      settings.novelCharset,
      props.aid,
      ch.cid,
      ch.title,
    );
    beginSession();
    void capabilities.novelProgressSet(props.aid, ch.cid, ch.title, 0);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

function prev() {
  if (currentIndex.value > 0) loadChapter(currentIndex.value - 1);
}

function next() {
  if (currentIndex.value < chapters.value.length - 1) loadChapter(currentIndex.value + 1);
}

async function init() {
  loading.value = true;
  try {
    volumes.value = await capabilities.novelCatalogue(settings.wenku8Node, settings.novelCharset, props.aid);
    flattenChapters();
    let start = 0;
    const progress = await capabilities.novelProgressGet(props.aid);
    if (progress) {
      const idx = chapters.value.findIndex((c) => c.cid === progress.cid);
      if (idx >= 0) start = idx;
    } else if (props.initialCid) {
      const idx = chapters.value.findIndex((c) => c.cid === props.initialCid);
      if (idx >= 0) start = idx;
    }
    await loadChapter(start);
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e);
    loading.value = false;
  }
}

function close() {
  flushSession();
  emit("close");
}

onMounted(init);
onBeforeUnmount(flushSession);
</script>

<template>
  <div class="novel-reader" :style="{ background: theme.bg, color: theme.fg }">
    <div class="reader-topbar">
      <button class="tool-btn" @click="close">
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <div class="reader-title" :title="currentTitle">{{ currentTitle || props.title }}</div>
      <div class="spacer"></div>
      <button class="tool-btn" :disabled="currentIndex <= 0" @click="prev">
        <span class="material-symbols-outlined">chevron_left</span>
      </button>
      <button class="tool-btn" @click="showToc = true">
        <span class="material-symbols-outlined">list</span>
      </button>
      <button class="tool-btn" :disabled="currentIndex >= chapters.length - 1" @click="next">
        <span class="material-symbols-outlined">chevron_right</span>
      </button>
    </div>

    <!-- 目录抽屉 -->
    <Transition name="toc-fade">
      <div v-if="showToc" class="toc-mask" @click="showToc = false">
        <div class="toc-panel" @click.stop>
          <div class="toc-head">
            <h3>{{ t("novel.catalogue") }}</h3>
            <button class="tool-btn" @click="showToc = false">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
          <div class="toc-body">
            <button
              v-for="(ch, i) in chapters"
              :key="ch.cid"
              class="toc-row"
              :class="{ active: i === currentIndex }"
              @click="showToc = false; loadChapter(i)"
            >
              <span class="toc-title">{{ ch.title }}</span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <div class="reader-content" :style="{ fontFamily, fontSize: settings.readerFontPct + 'px', lineHeight: settings.readerLineHeight }">
      <p v-if="loading" class="state">{{ t("novel.loading") }}</p>
      <p v-else-if="error" class="state error">{{ error }}</p>
      <template v-else-if="content">
        <h2 class="chapter-title">{{ currentTitle }}</h2>
        <p v-for="(para, i) in content.text.split('\n\n')" :key="i" class="para" :style="{ marginBottom: settings.readerParaSpacing + 'em' }">{{ para }}</p>
      </template>
    </div>

    <div class="reader-footer">
      <button class="nav-btn" :disabled="currentIndex <= 0" @click="prev">上一章</button>
      <button class="nav-btn" :disabled="currentIndex >= chapters.length - 1" @click="next">下一章</button>
    </div>
  </div>
</template>

<style scoped>
.novel-reader {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.reader-topbar {
  flex: none;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 52px;
  padding: 0 12px;
  background: color-mix(in srgb, currentColor 6%, transparent);
}
.tool-btn {
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
}
.tool-btn:hover {
  background: color-mix(in srgb, currentColor 12%, transparent);
}
.tool-btn:disabled {
  opacity: 0.35;
}
.reader-title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.spacer {
  flex: 1;
}
.reader-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px clamp(20px, 8vw, 120px);
  line-height: 1.7;
}
.chapter-title {
  margin: 0 0 20px;
  font-size: 20px;
  font-weight: 600;
}
.para {
  margin: 0 0 1em;
  white-space: pre-wrap;
  word-break: break-word;
  text-indent: 2em;
}
.state {
  padding: 40px 0;
  text-align: center;
  opacity: 0.7;
}
.state.error {
  opacity: 1;
}
.reader-footer {
  flex: none;
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 16px 16px;
}
.nav-btn {
  padding: 10px 20px;
  border: none;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, currentColor 12%, transparent);
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  cursor: pointer;
}
.nav-btn:disabled {
  opacity: 0.35;
}
.toc-mask {
  position: absolute;
  inset: 0;
  z-index: 20;
  display: flex;
  justify-content: flex-start;
  background: rgba(0, 0, 0, 0.4);
}
.toc-panel {
  display: flex;
  flex-direction: column;
  width: min(360px, 85vw);
  height: 100%;
  background: color-mix(in srgb, currentColor 8%, transparent);
  box-shadow: var(--md-elevation-3);
}
.toc-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent);
}
.toc-head h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.toc-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}
.toc-row {
  display: block;
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: inherit;
  font-family: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.toc-row:hover {
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.toc-row.active {
  background: color-mix(in srgb, currentColor 16%, transparent);
  font-weight: 600;
}
.toc-title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.toc-fade-enter-active,
.toc-fade-leave-active {
  transition: opacity 160ms ease;
}
.toc-fade-enter-from,
.toc-fade-leave-to {
  opacity: 0;
}
</style>