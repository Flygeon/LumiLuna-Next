<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { capabilities } from "@/capabilities";
import { translate } from "@shared/i18n";
import { requestRelogin } from "@/novel/wenku8Auth";
import { isLoginRequiredError } from "@/novel/wenku8Login";
import type { NovelDetail, NovelVolume } from "@shared/types";

const props = defineProps<{ aid: string; initialTitle?: string }>();
const emit = defineEmits<{
  (e: "back"): void;
  (e: "read", cid: string, title: string): void;
}>();

const settings = useSettingsStore();
const t = (key: string) => translate(settings.lang, key);

const loading = ref(true);
const error = ref("");
const detail = ref<NovelDetail | null>(null);
const volumes = ref<NovelVolume[]>([]);
const inShelf = ref(false);
const shelfBusy = ref(false);

onMounted(async () => {
  try {
    const [d, vols, shelf] = await Promise.all([
      capabilities.novelDetail(settings.wenku8Node, settings.novelCharset, props.aid),
      capabilities.novelCatalogue(settings.wenku8Node, settings.novelCharset, props.aid),
      capabilities.novelShelfList(),
    ]);
    detail.value = d;
    volumes.value = vols;
    inShelf.value = shelf.some((s) => s.aid === props.aid);
  } catch (e) {
    if (isLoginRequiredError(e)) {
      requestRelogin();
      error.value = "登录态已失效，请重新登录。";
    } else {
      error.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    loading.value = false;
  }
});

async function toggleShelf() {
  if (!detail.value || shelfBusy.value) return;
  shelfBusy.value = true;
  try {
    if (inShelf.value) {
      await capabilities.novelShelfRemove(props.aid);
      inShelf.value = false;
    } else {
      await capabilities.novelShelfAdd(
        props.aid,
        detail.value.title,
        detail.value.author,
        detail.value.imgUrl,
      );
      inShelf.value = true;
    }
  } finally {
    shelfBusy.value = false;
  }
}
</script>

<template>
  <div class="novel-detail">
    <div v-if="loading" class="state">{{ t("novel.loading") }}</div>
    <p v-else-if="error" class="state error">{{ error }}</p>
    <template v-else-if="detail">
      <div class="head">
        <button class="back" @click="emit('back')">
          <span class="material-symbols-outlined">arrow_back</span>
          {{ t("novel.back") }}
        </button>
        <button class="lm-btn lm-btn--tonal" :disabled="shelfBusy" @click="toggleShelf">
          <span class="material-symbols-outlined">{{ inShelf ? "bookmark_remove" : "bookmark_add" }}</span>
          {{ inShelf ? t("novel.removeShelf") : t("novel.addShelf") }}
        </button>
      </div>

      <div class="hero">
        <div class="cover">
          <img v-if="detail.imgUrl" :src="detail.imgUrl" :alt="detail.title" />
          <span v-else class="material-symbols-outlined">menu_book</span>
        </div>
        <div class="info">
          <h2 class="title">{{ detail.title }}</h2>
          <p v-if="detail.author" class="line">{{ t("novel.author") }}：{{ detail.author }}</p>
          <p v-if="detail.status" class="line">{{ t("novel.status") }}：{{ detail.status }}</p>
          <p v-if="detail.finUpdate" class="line">{{ t("novel.update") }}：{{ detail.finUpdate }}</p>
          <div v-if="detail.tags.length" class="tags">
            <span v-for="tag in detail.tags" :key="tag" class="tag">{{ tag }}</span>
          </div>
        </div>
      </div>

      <p v-if="detail.introduce" class="intro">{{ detail.introduce }}</p>

      <div class="catalogue">
        <h3 class="catalogue-title">{{ t("novel.catalogue") }}</h3>
        <div v-if="volumes.length === 0" class="state">{{ t("novel.emptyCatalogue") }}</div>
        <template v-for="(vol, vi) in volumes" :key="vi">
          <h4 class="volume-title">{{ vol.title || `Vol.${vi + 1}` }}</h4>
          <button
            v-for="ch in vol.chapters"
            :key="ch.cid"
            class="chapter-row"
            @click="emit('read', ch.cid, ch.title)"
          >
            <span class="material-symbols-outlined">description</span>
            <span class="chapter-name" :title="ch.title">{{ ch.title }}</span>
          </button>
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.novel-detail {
  display: flex;
  flex-direction: column;
  gap: 16px;
  animation: lm-rise 320ms var(--md-sys-motion-easing-emphasized-decelerate) both;
}
.state {
  padding: 40px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.state.error {
  color: var(--md-sys-color-error);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
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
.hero {
  display: flex;
  gap: 16px;
}
.cover {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 120px;
  aspect-ratio: 3 / 4;
  border-radius: var(--md-sys-shape-corner-large);
  overflow: hidden;
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-outline);
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.info {
  flex: 1;
  min-width: 0;
}
.title {
  margin: 0 0 8px;
  font-size: var(--md-sys-typescale-title-large-size);
  font-weight: 600;
}
.line {
  margin: 4px 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.tag {
  padding: 3px 10px;
  border-radius: var(--md-sys-shape-corner-full);
  font-size: var(--md-sys-typescale-label-small-size);
  background: var(--md-sys-color-secondary-container);
  color: var(--md-sys-color-on-secondary-container);
}
.intro {
  margin: 0;
  padding: 14px 16px;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.7;
  color: var(--md-sys-color-on-surface-variant);
  white-space: pre-wrap;
}
.catalogue {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.catalogue-title {
  margin: 8px 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 600;
}
.volume-title {
  margin: 12px 0 4px;
  font-size: var(--md-sys-typescale-title-small-size);
  font-weight: 600;
  color: var(--md-sys-color-on-surface-variant);
}
.chapter-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: transparent;
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  font-size: var(--md-sys-typescale-body-medium-size);
  text-align: left;
  cursor: pointer;
}
.chapter-row:hover {
  background: var(--md-sys-color-surface-container);
}
.chapter-row .material-symbols-outlined {
  font-size: 18px;
  color: var(--md-sys-color-primary);
}
.chapter-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>