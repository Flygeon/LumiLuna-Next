/**
 * 皮肤系统 store：皮肤库列表、导入（校验/远程引用确认/覆盖更新）、激活、删除、
 * 内置皮肤播种与安全模式。设计见 doc/皮肤系统开发方案书.md §6/§8。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { capabilities, isTauri } from "@/capabilities";
import { useSettingsStore } from "./settings";
import { validateSkin, type SkinDocument } from "@/utils/skinSchema";
import { activeSkinDoc, skinSafeMode } from "@/utils/skinRuntime";
import { translate } from "@shared/i18n";
import type { SkinEntry } from "@shared/types";

// 内置示例皮肤（构建期以原文嵌入，首次启动播种进皮肤库；各演示一项机制）
import builtinMonoInk from "@/skins/lumiluna.mono-ink.json?raw";
import builtinRoundify from "@/skins/lumiluna.roundify.json?raw";
import builtinMidnight from "@/skins/lumiluna.midnight.json?raw";
import builtinMd1 from "@/skins/lumiluna.md1.json?raw";

const BUILTIN_SKINS = [
  { id: "lumiluna.mono-ink", json: builtinMonoInk },
  { id: "lumiluna.roundify", json: builtinRoundify },
  { id: "lumiluna.midnight", json: builtinMidnight },
  { id: "lumiluna.md1", json: builtinMd1 },
];

async function appVersionSafe(): Promise<string> {
  try {
    if (isTauri) {
      const { getVersion } = await import("@tauri-apps/api/app");
      return await getVersion();
    }
  } catch {
    /* 取不到版本就按当前发布版本处理，仅影响 minAppVersion 门槛 */
  }
  return "1.1.0";
}

export const useSkinsStore = defineStore("skins", () => {
  const settings = useSettingsStore();
  const list = ref<SkinEntry[]>([]);
  const loaded = ref(false);
  /** 全局通知（App.vue 渲染 toast，自动消失） */
  const notice = ref<string | null>(null);
  /** 远程引用导入待确认（App.vue 渲染确认对话框，方案书 §2 D5） */
  const pendingRemote = ref<{ refs: string[]; skin: SkinDocument } | null>(null);

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

  async function load() {
    // 逃生通道：--safe-mode 启动时本会话不应用任何皮肤（resolveTheme 读取该标志）
    skinSafeMode.value = await capabilities.appSafeMode();
    await refresh();

    // 播种内置皮肤：库中无对应 id 且用户没删除过（hiddenBuiltinSkins 记忆）才写入
    const hidden = settings.hiddenBuiltinSkins;
    let seeded = false;
    for (const b of BUILTIN_SKINS) {
      if (list.value.some((s) => s.id === b.id) || hidden.includes(b.id)) continue;
      const v = validateSkin(b.json);
      if (v.ok && v.skin) {
        await capabilities.skinSave(b.id, JSON.stringify(v.skin));
        seeded = true;
      } else {
        // 内置皮肤与校验器同步演进，校验失败说明开发期就出了问题
        console.warn(`[skins] 内置皮肤 ${b.id} 校验失败:`, v.errors);
      }
    }
    if (seeded) await refresh();

    // 解析激活皮肤：文件丢失/被改坏时自动回退默认并提示（§6.6）
    const activeId = settings.activeSkin;
    if (activeId) {
      const raw = await capabilities.skinLoad(activeId);
      const v = raw === null ? null : validateSkin(raw);
      if (v?.ok && v.skin) {
        activeSkinDoc.value = v.skin;
      } else {
        settings.activeSkin = "";
        activeSkinDoc.value = null;
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
      settings.resolveTheme();
      return;
    }
    const raw = await capabilities.skinLoad(id);
    const v = raw === null ? null : validateSkin(raw);
    if (v?.ok && v.skin) {
      settings.activeSkin = id;
      activeSkinDoc.value = v.skin;
      settings.resolveTheme();
    } else {
      notify(tr("settings.skinBroken"));
    }
  }

  async function remove(id: string) {
    if (settings.activeSkin === id) await activate("");
    // 内置皮肤删除后不再复活（写入记忆，方案书 §10）
    if (
      BUILTIN_SKINS.some((b) => b.id === id) &&
      !settings.hiddenBuiltinSkins.includes(id)
    ) {
      settings.hiddenBuiltinSkins.push(id);
    }
    await capabilities.skinDelete(id);
    await refresh();
    notify(tr("settings.skinDeleted"));
  }

  /**
   * 从外部文件导入：读取 → 严格校验（拒绝即提示首个错误）→
   * 远程引用先弹确认 → 落盘固化（同 id = 覆盖更新，§2 D7/D8）。
   */
  async function importFromFile(path: string): Promise<void> {
    if (!path.toLowerCase().endsWith(".json")) {
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

  /** 用户确认「仍然导入」后落盘 */
  async function confirmRemoteImport() {
    const p = pendingRemote.value;
    pendingRemote.value = null;
    if (p) await commitImport(p.skin);
  }

  function cancelRemoteImport() {
    pendingRemote.value = null;
  }

  async function commitImport(skin: SkinDocument) {
    const prev = list.value.find((s) => s.id === skin.manifest.id);
    await capabilities.skinSave(skin.manifest.id, JSON.stringify(skin));
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
