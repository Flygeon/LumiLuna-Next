/**
 * 皮肤系统 store：皮肤库列表、导入（v1 JSON 直存 / v2 ZIP 两阶段 staging）、
 * 激活、删除与安全模式。设计见 doc/皮肤系统开发方案书.md 与 v2 方案书。
 * 示例皮肤不再内置播种——统一放仓库 example/ 目录由用户自行下载导入。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { capabilities, isTauri } from "@/capabilities";
import { useSettingsStore } from "./settings";
import { validateSkin, type SkinDocument } from "@/utils/skinSchema";
import { prepareSkin } from "@/utils/skinLoader";
import { activePrepared, activeSkinDoc, skinSafeMode } from "@/utils/skinRuntime";
import { translate } from "@shared/i18n";
import type { SkinEntry } from "@shared/types";

async function appVersionSafe(): Promise<string> {
  try {
    if (isTauri) {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    }
  } catch {
    /* 取不到版本就按当前发布版本处理，仅影响 minAppVersion 门槛 */
  }
  // 非 Tauri（浏览器预览）时用构建期注入的版本，别再写死字符串
  return __APP_VERSION__;
}

export const useSkinsStore = defineStore("skins", () => {
  const settings = useSettingsStore();
  const list = ref<SkinEntry[]>([]);
  const loaded = ref(false);
  /** skins 库根目录（skin_dir 命令缓存，prepareSkin 拼 asset:// 用） */
  const skinsRoot = ref<string | null>(null);
  /** 全局通知（App.vue 渲染 toast，自动消失） */
  const notice = ref<string | null>(null);
  /** 导入待确认（远程引用知情确认，v1 D5）；staging 非空 = v2 ZIP 在途 */
  const pendingRemote = ref<{
    refs: string[];
    skin: SkinDocument;
    staging?: string;
  } | null>(null);

  let noticeTimer: number | undefined;
  function notify(msg: string) {
    notice.value = msg;
    if (noticeTimer) window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => (notice.value = null), 5000);
  }

  function tr(key: string) {
    return translate(settings.lang, key);
  }

  async function refresh() {
    list.value = await capabilities.skinList();
  }

  /** 解析并挂载激活皮肤（启动 load 与 activate 共用）；失败返回 false */
  async function mountActive(id: string): Promise<boolean> {
    if (!skinsRoot.value) {
      skinsRoot.value = await capabilities.skinDir().catch(() => null);
    }
    const loadedSkin = await capabilities.skinLoad(id);
    const v =
      loadedSkin.json === null || loadedSkin.json === undefined
        ? null
        : validateSkin(loadedSkin.json, { files: loadedSkin.files });
    if (v?.ok && v.skin) {
      activeSkinDoc.value = v.skin;
      activePrepared.value = prepareSkin(v.skin, {
        id,
        skinsDir: skinsRoot.value,
        files: loadedSkin.files,
      });
      return true;
    }
    return false;
  }

  async function load() {
    // 逃生通道：--safe-mode 启动时本会话不应用任何皮肤（resolveTheme 读取该标志）
    skinSafeMode.value = await capabilities.appSafeMode();
    await refresh();

    // 解析激活皮肤：文件丢失/被改坏时自动回退默认并提示（v1 §6.6）
    const activeId = settings.activeSkin;
    if (activeId) {
      const ok = await mountActive(activeId);
      if (!ok) {
        settings.activeSkin = "";
        activeSkinDoc.value = null;
        activePrepared.value = null;
        notify(tr("settings.skinActiveLost"));
      }
    }
    if (skinSafeMode.value && activeSkinDoc.value) {
      notify(tr("settings.skinSafeMode"));
    }
    loaded.value = true;
  }

  /** 激活皮肤；id 为空串 = 回到默认皮肤（动态配色） */
  async function activate(id: string) {
    if (!id) {
      settings.activeSkin = "";
      activeSkinDoc.value = null;
      activePrepared.value = null;
      settings.resolveTheme();
      return;
    }
    const ok = await mountActive(id);
    if (ok) {
      settings.activeSkin = id;
      settings.resolveTheme();
    } else {
      notify(tr("settings.skinBroken"));
    }
  }

  async function remove(id: string) {
    if (settings.activeSkin === id) await activate("");
    await capabilities.skinDelete(id);
    await refresh();
    notify(tr("settings.skinDeleted"));
  }

  /**
   * 从外部文件导入：
   * - .json（v1）：读取 → 校验 → 远程引用确认 → skinSave 固化（同 id = 覆盖更新）
   * - .zip（v2）：skin_stage_zip 解包到 staging → 校验（含资产清单）→ 确认 → commit 原子换入
   */
  async function importFromFile(path: string): Promise<void> {
    const lower = path.toLowerCase();
    if (lower.endsWith(".zip")) {
      await importZip(path);
      return;
    }
    if (!lower.endsWith(".json")) {
      notify(tr("settings.skinDropUnsupported"));
      return;
    }
    let raw: string;
    try {
      raw = await capabilities.skinReadExternalFile(path);
    } catch (e) {
      notify(String(e));
      return;
    }
    const appVersion = await appVersionSafe();
    const v = validateSkin(raw, { appVersion });
    if (!v.ok || !v.skin) {
      notify(`${tr("settings.skinRejected")}：${v.errors[0]}`);
      if (v.errors.length > 1) console.warn("[skins] 完整校验错误:", v.errors);
      return;
    }
    const remote = v.warnings.find((w) => w.kind === "remote-ref");
    if (remote && !pendingRemote.value) {
      pendingRemote.value = { refs: remote.refs, skin: v.skin };
      return;
    }
    await commitImport(v.skin);
  }

  async function importZip(path: string): Promise<void> {
    let staged;
    try {
      staged = await capabilities.skinStageZip(path);
    } catch (e) {
      notify(String(e));
      return;
    }
    const appVersion = await appVersionSafe();
    const v = validateSkin(staged.json, { appVersion, files: staged.files });
    if (!v.ok || !v.skin) {
      void capabilities.skinAbort(staged.staging).catch(() => {});
      notify(`${tr("settings.skinRejected")}：${v.errors[0]}`);
      if (v.errors.length > 1) console.warn("[skins] 完整校验错误:", v.errors);
      return;
    }
    const remote = v.warnings.find((w) => w.kind === "remote-ref");
    if (remote && !pendingRemote.value) {
      pendingRemote.value = { refs: remote.refs, skin: v.skin, staging: staged.staging };
      return;
    }
    await finalizeImport(v.skin, staged.staging);
  }

  /** 用户确认「仍然导入」后落盘 */
  async function confirmRemoteImport() {
    const p = pendingRemote.value;
    pendingRemote.value = null;
    if (p) await finalizeImport(p.skin, p.staging);
  }

  function cancelRemoteImport() {
    const p = pendingRemote.value;
    pendingRemote.value = null;
    if (p?.staging) {
      void capabilities.skinAbort(p.staging).catch(() => {});
    }
  }

  /** 最终落盘：v1 走 skinSave，v2 staging 走 commit（同 id = 覆盖更新） */
  async function finalizeImport(skin: SkinDocument, staging?: string) {
    const prev = list.value.find((s) => s.id === skin.manifest.id);
    try {
      if (staging) {
        await capabilities.skinCommit(staging, skin.manifest.id);
      } else {
        await capabilities.skinSave(skin.manifest.id, JSON.stringify(skin));
      }
    } catch (e) {
      notify(String(e));
      return;
    }
    await refresh();
    if (prev?.meta) {
      notify(
        tr("settings.skinUpdated")
          .replace("{name}", skin.manifest.name)
          .replace("{old}", prev.meta.version)
          .replace("{new}", skin.manifest.version),
      );
    } else {
      notify(tr("settings.skinImported").replace("{name}", skin.manifest.name));
    }
  }

  async function commitImport(skin: SkinDocument) {
    await finalizeImport(skin);
  }

  return {
    list,
    loaded,
    notice,
    pendingRemote,
    load,
    refresh,
    activate,
    remove,
    importFromFile,
    confirmRemoteImport,
    cancelRemoteImport,
  };
});
