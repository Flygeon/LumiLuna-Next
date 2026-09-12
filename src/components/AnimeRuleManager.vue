<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useSettingsStore } from "@/stores/settings";
import { useAnimeStore } from "@/stores/anime";
import { translate } from "@shared/i18n";
import { capabilities } from "@/capabilities";
import { normalizeRule, validateRule } from "@/utils/animeRules";

const emit = defineEmits<{ (e: "back"): void }>();

const settings = useSettingsStore();
const anime = useAnimeStore();
const t = (key: string) => translate(settings.lang, key);

const json = ref("");
const saveError = ref("");
const savedToast = ref(false);
const confirmDelete = ref<string | null>(null);
let deleteTimer: number | undefined;

/** KazumiRules 仓库 index.json 只是目录，真实规则在 <name>.json（照 Kazumi plugin_catalog_api） */
const REPO_BASE = "https://raw.githubusercontent.com/Predidit/KazumiRules/main/";
interface RepoEntry {
  name: string;
  version: string;
  author: string;
  antiCrawlerEnabled: boolean;
}
const repoBusy = ref(false);
const repoError = ref("");
const repoItems = ref<RepoEntry[]>([]);
const importingName = ref("");
const repoImported = ref("");

onMounted(() => void anime.loadRules(true));

function pickRule(name: string) {
  anime.pickRule(name);
  emit("back");
}

async function saveRule() {
  saveError.value = "";
  let name: string;
  try {
    const rule = normalizeRule(JSON.parse(json.value));
    const errors = validateRule(rule);
    if (errors.length) {
      saveError.value = errors.join("；");
      return;
    }
    name = rule.name;
    await capabilities.animeRuleSave(name, JSON.stringify(rule, null, 2));
  } catch (e) {
    saveError.value = e instanceof Error ? e.message : String(e);
    return;
  }
  savedToast.value = true;
  window.setTimeout(() => (savedToast.value = false), 2000);
  json.value = "";
  await anime.loadRules(true);
  pickRule(name);
}

function onDelete(name: string) {
  if (confirmDelete.value === name) {
    confirmDelete.value = null;
    if (deleteTimer) window.clearTimeout(deleteTimer);
    void (async () => {
      await capabilities.animeRuleDelete(name);
      await anime.loadRules(true);
    })();
  } else {
    confirmDelete.value = name;
    if (deleteTimer) window.clearTimeout(deleteTimer);
    deleteTimer = window.setTimeout(() => (confirmDelete.value = null), 3000);
  }
}

/** 拉取仓库目录（index.json 只有 name/version 等元数据） */
async function fetchRepo() {
  repoBusy.value = true;
  repoError.value = "";
  repoItems.value = [];
  repoImported.value = "";
  try {
    const index = await capabilities.animeRuleIndex();
    const parsed: unknown = JSON.parse(index);
    let list: unknown[] = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (Array.isArray(obj.rules)) list = obj.rules;
      else {
        list = Object.values(obj).filter((v) => v && typeof v === "object");
      }
    }
    const seen = new Set<string>();
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      const o = item as Record<string, unknown>;
      const name = String(o.name ?? "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      repoItems.value.push({
        name,
        version: String(o.version ?? ""),
        author: String(o.author ?? ""),
        antiCrawlerEnabled: o.antiCrawlerEnabled === true,
      });
    }
    if (!repoItems.value.length) {
      repoError.value = t("anime.rule.fromRepoEmpty");
    }
  } catch (e) {
    repoError.value = e instanceof Error ? e.message : String(e);
  } finally {
    repoBusy.value = false;
  }
}

/** 导入：拉取该规则真实 JSON → 规范化校验 → 保存启用 */
async function importFromRepo(entry: RepoEntry) {
  importingName.value = entry.name;
  repoError.value = "";
  repoImported.value = "";
  try {
    const rawUrl = `${REPO_BASE}${encodeURIComponent(entry.name)}.json`;
    const res = await capabilities.animeFetch(entry.name, {
      method: "GET",
      url: rawUrl,
      headers: {},
      includeCookies: false,
    });
    const rule = normalizeRule(JSON.parse(res.html));
    if (rule.type !== "anime") {
      throw new Error(`${t("anime.rule.invalid")}：规则类型不是 anime`);
    }
    const errors = validateRule(rule);
    if (errors.length) {
      throw new Error(`${t("anime.rule.invalid")}：${errors.join("；")}`);
    }
    await capabilities.animeRuleSave(rule.name, JSON.stringify(rule, null, 2));
    await anime.loadRules(true);
    repoImported.value = rule.name;
    if (rule.name !== entry.name) {
      repoItems.value = repoItems.value.map((e) =>
        e.name === entry.name ? { ...e, name: rule.name } : e,
      );
    }
  } catch (e) {
    repoError.value = e instanceof Error ? e.message : String(e);
  } finally {
    importingName.value = "";
  }
}
</script>

<template>
  <div class="anime-rules">
    <div class="head">
      <button class="back" @click="emit('back')">
        <span class="material-symbols-outlined">arrow_back</span>
        {{ t("anime.back") }}
      </button>
    </div>

    <!-- 已装规则 -->
    <section class="section">
      <h3 class="section-title">{{ t("anime.manageRules") }}</h3>
      <div v-if="anime.rulesLoading" class="state">{{ t("anime.loading") }}</div>
      <div v-else-if="!anime.rules.length" class="state">{{ t("anime.noSource") }}</div>
      <div v-else class="rule-list">
        <div
          v-for="r in anime.rules"
          :key="r.name"
          class="rule-row"
          :class="{ active: anime.activeRuleName === r.name, disabled: !r.enabled }"
          @click="pickRule(r.name)"
        >
          <span class="material-symbols-outlined">rule</span>
          <span class="rule-name" :title="r.name">{{ r.name }}</span>
          <span v-if="r.version" class="rule-ver tabular-nums">v{{ r.version }}</span>
          <span v-if="!r.enabled" class="rule-badge">{{ t("anime.rule.disabled") }}</span>
          <button
            class="lm-icon-btn small rule-toggle"
            :class="{ off: !r.enabled }"
            :title="r.enabled ? t('anime.rule.disable') : t('anime.rule.enable')"
            @click.stop="anime.setRuleEnabled(r.name, !r.enabled)"
          >
            <span class="material-symbols-outlined">{{
              r.enabled ? "toggle_on" : "toggle_off"
            }}</span>
          </button>
          <button
            class="lm-icon-btn small danger rule-del"
            :class="{ confirming: confirmDelete === r.name }"
            :title="
              confirmDelete === r.name ? t('anime.rule.deleteConfirm') : t('anime.rule.delete')
            "
            @click.stop="onDelete(r.name)"
          >
            <span class="material-symbols-outlined">
              {{ confirmDelete === r.name ? "check" : "close" }}
            </span>
          </button>
        </div>
      </div>
    </section>

    <!-- 导入 -->
    <section class="section">
      <h3 class="section-title">{{ t("anime.rule.importJson") }}</h3>
      <textarea
        v-model="json"
        :placeholder="t('anime.rule.importPlaceholder')"
        rows="8"
        spellcheck="false"
      ></textarea>
      <p v-if="saveError" class="error">{{ saveError }}</p>
      <div class="actions">
        <button class="lm-btn lm-btn--tonal" :disabled="!json.trim()" @click="saveRule">
          <span class="material-symbols-outlined">save</span>
          {{ t("anime.rule.save") }}
        </button>
        <button class="lm-btn lm-btn--outlined" :disabled="repoBusy" @click="fetchRepo">
          <span v-if="repoBusy" class="material-symbols-outlined spin">progress_activity</span>
          <span v-else class="material-symbols-outlined">cloud_download</span>
          {{ repoBusy ? t("anime.rule.fromRepoFetching") : t("anime.rule.fromRepo") }}
        </button>
      </div>
      <p v-if="repoError" class="error">{{ repoError }}</p>
      <div v-if="repoItems.length" class="repo-list">
        <button
          v-for="entry in repoItems"
          :key="entry.name"
          class="repo-row"
          :disabled="importingName === entry.name"
          @click="importFromRepo(entry)"
        >
          <span v-if="importingName === entry.name" class="material-symbols-outlined spin"
            >progress_activity</span
          >
          <span v-else-if="repoImported === entry.name" class="material-symbols-outlined ok"
            >check</span
          >
          <span v-else class="material-symbols-outlined">add</span>
          <span class="rule-name" :title="entry.name">{{ entry.name }}</span>
          <span v-if="entry.version" class="rule-ver tabular-nums">v{{ entry.version }}</span>
          <span v-if="entry.antiCrawlerEnabled" class="badge">{{
            t("anime.rule.antiCrawler")
          }}</span>
        </button>
      </div>
      <p v-else-if="repoBusy" class="state">{{ t("anime.rule.fromRepoFetching") }}</p>
      <p v-if="repoImported" class="hint ok-hint">
        {{ t("anime.rule.imported") }} {{ repoImported }}
      </p>
    </section>

    <transition name="toast">
      <div v-if="savedToast" class="toast">{{ t("anime.rule.saved") }}</div>
    </transition>
  </div>
</template>

<style scoped>
.anime-rules {
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 760px;
  animation: lm-rise 320ms var(--md-sys-motion-spring-spatial) both;
}
.head {
  display: flex;
  align-items: center;
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
.section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.section-title {
  margin: 0;
  font-size: var(--md-sys-typescale-title-medium-size);
  font-weight: 500;
}
.state {
  padding: 20px 0;
  text-align: center;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.error {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-error);
}
.rule-list,
.repo-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-row,
.repo-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 8px 10px 14px;
  border: none;
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: inherit;
  text-align: left;
  cursor: pointer;
}
.rule-row:hover,
.repo-row:hover {
  background: var(--md-sys-color-surface-container-high);
}
.rule-row.active {
  box-shadow: inset 0 0 0 2px var(--md-sys-color-primary);
}
.rule-row.disabled {
  opacity: 0.55;
}
.rule-row.disabled .rule-name {
  text-decoration: line-through;
  text-decoration-color: var(--md-sys-color-outline);
}
.rule-badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-outline) 18%, transparent);
  color: var(--md-sys-color-on-surface-variant);
  font-size: var(--md-sys-typescale-label-small-size);
}
.rule-toggle {
  width: 30px;
  height: 30px;
  color: var(--md-sys-color-primary);
}
.rule-toggle.off {
  color: var(--md-sys-color-outline);
}
.rule-row > .material-symbols-outlined,
.repo-row > .material-symbols-outlined {
  font-size: 19px;
  color: var(--md-sys-color-primary);
}
.rule-name {
  flex: 1;
  min-width: 0;
  font-size: var(--md-sys-typescale-body-medium-size);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.rule-ver {
  font-size: var(--md-sys-typescale-label-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.rule-del {
  width: 30px;
  height: 30px;
  opacity: 0;
}
.rule-row:hover .rule-del {
  opacity: 1;
}
.rule-del.confirming {
  opacity: 1;
  color: var(--md-sys-color-error);
}
textarea {
  width: 100%;
  padding: 12px;
  border: 1px solid var(--md-sys-color-outline-variant);
  border-radius: var(--md-sys-shape-corner-medium);
  background: var(--md-sys-color-surface-container);
  color: var(--md-sys-color-on-surface);
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
  font-size: var(--md-sys-typescale-body-small-size);
  line-height: 1.5;
  resize: vertical;
  outline: none;
  box-sizing: border-box;
}
textarea:focus {
  border-color: var(--md-sys-color-primary);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.actions .material-symbols-outlined {
  font-size: 18px;
}
.spin {
  animation: lm-spin 1s linear infinite;
}
@keyframes lm-spin {
  to {
    transform: rotate(360deg);
  }
}
.repo-row {
  background: transparent;
  box-shadow: inset 0 0 0 1px var(--lm-hairline);
}
.repo-row:hover {
  background: color-mix(in srgb, var(--md-sys-color-primary) 8%, transparent);
}
.repo-row:disabled {
  opacity: 0.6;
  cursor: wait;
}
.repo-row > .material-symbols-outlined.ok {
  color: var(--md-sys-color-tertiary);
}
.repo-row > .material-symbols-outlined.spin {
  color: var(--md-sys-color-on-surface-variant);
}
.badge {
  flex-shrink: 0;
  padding: 1px 8px;
  border-radius: var(--md-sys-shape-corner-full);
  background: color-mix(in srgb, var(--md-sys-color-error) 12%, transparent);
  color: var(--md-sys-color-error);
  font-size: var(--md-sys-typescale-label-small-size);
}
.hint {
  margin: 0;
  font-size: var(--md-sys-typescale-body-small-size);
  color: var(--md-sys-color-on-surface-variant);
}
.ok-hint {
  color: var(--md-sys-color-tertiary);
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
</style>
