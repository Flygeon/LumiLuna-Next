/**
 * 内置皮肤播种回归：首次启动写入 / 已有同 id 不覆盖 / 删除记忆不复活 /
 * 写盘失败不阻断启动。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

const skinSave = vi.fn();
const skinDelete = vi.fn();
const skinList = vi.fn();
const skinDir = vi.fn();
const skinLoad = vi.fn();
const appSafeMode = vi.fn();

vi.mock("@/capabilities", () => ({
  isTauri: false,
  capabilities: {
    skinSave: (...a: unknown[]) => skinSave(...a),
    skinDelete: (...a: unknown[]) => skinDelete(...a),
    skinList: (...a: unknown[]) => skinList(...a),
    skinDir: (...a: unknown[]) => skinDir(...a),
    skinLoad: (...a: unknown[]) => skinLoad(...a),
    appSafeMode: (...a: unknown[]) => appSafeMode(...a),
  },
}));

/** 假的设置 store：必须是稳定对象，否则 store 里对 hiddenBuiltinSkins 的赋值会写丢 */
const h = vi.hoisted(() => ({
  settings: {
    activeSkin: "",
    hiddenBuiltinSkins: [] as string[],
    lang: "zh",
    resolveTheme: () => {},
  },
}));
vi.mock("../settings", () => ({ useSettingsStore: () => h.settings }));

import { useSkinsStore } from "../skins";

const BUILTIN_ID = "lumiluna.ak-ui";

beforeEach(() => {
  setActivePinia(createPinia());
  // notify() 用 window.setTimeout 自动消失 toast；node 环境没有 window，也不该留下挂起定时器
  vi.stubGlobal("window", { setTimeout: () => 0, clearTimeout: () => {} });
  h.settings.hiddenBuiltinSkins = [];
  skinSave.mockReset().mockResolvedValue(undefined);
  skinDelete.mockReset().mockResolvedValue(undefined);
  skinList.mockReset().mockResolvedValue([]);
  skinDir.mockReset().mockResolvedValue("C:/mock/skins");
  skinLoad.mockReset().mockResolvedValue({ json: null, files: [] });
  appSafeMode.mockReset().mockResolvedValue(false);
});

describe("内置皮肤播种", () => {
  it("空库首次启动写入内置皮肤（存的是校验后的规范化文档）", async () => {
    const store = useSkinsStore();
    await store.load();
    expect(skinSave).toHaveBeenCalledTimes(1);
    const [id, json] = skinSave.mock.calls[0] as [string, string];
    expect(id).toBe(BUILTIN_ID);
    const saved = JSON.parse(json);
    expect(saved.formatVersion).toBe(1);
    expect(saved.manifest.id).toBe(BUILTIN_ID);
    expect(saved.css).toBeTruthy();
    expect(store.loaded).toBe(true);
  });

  it("库中已有同 id 时不覆盖（视为用户改动）", async () => {
    skinList.mockResolvedValue([{ id: BUILTIN_ID, status: "ok", meta: null }]);
    await useSkinsStore().load();
    expect(skinSave).not.toHaveBeenCalled();
  });

  it("hiddenBuiltinSkins 记忆后不再播种", async () => {
    h.settings.hiddenBuiltinSkins = [BUILTIN_ID];
    await useSkinsStore().load();
    expect(skinSave).not.toHaveBeenCalled();
  });

  it("删除内置皮肤写入 hiddenBuiltinSkins（重启不复活）", async () => {
    const store = useSkinsStore();
    await store.remove(BUILTIN_ID);
    expect(skinDelete).toHaveBeenCalledWith(BUILTIN_ID);
    expect(h.settings.hiddenBuiltinSkins).toContain(BUILTIN_ID);
  });

  it("写盘失败只告警，不阻断启动", async () => {
    skinSave.mockRejectedValue(new Error("disk full"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = useSkinsStore();
    await expect(store.load()).resolves.toBeUndefined();
    expect(store.loaded).toBe(true);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
