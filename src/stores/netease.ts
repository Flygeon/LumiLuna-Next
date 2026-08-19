/**
 * 网易云账号 store：登录态、我的歌单、云盘分页、扫码弹窗状态。
 * 请求全走 Rust 命令（签名/cookie 在 Rust 侧）；浏览器预览由 mock 支撑。
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import QRCode from "qrcode";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import { clearSongUrlCache } from "@/utils/netease";
import type { NeteasePlaylist, NeteaseProfile, NeteaseSong } from "@shared/types";

/** 扫码轮询间隔：等待/已扫码 2s，确认中 1s */
const POLL_INTERVAL = 2000;
const POLL_CONFIRMED_INTERVAL = 1000;

export type QrState =
  | "wait"
  | "scanned"
  | "confirmed"
  | "success"
  | "timeout"
  | "error";

export const useNeteaseStore = defineStore("netease", () => {
  const loggedIn = ref(false);
  const profile = ref<NeteaseProfile | null>(null);
  const playlists = ref<NeteasePlaylist[]>([]);
  const cloudCount = ref(0);
  const cloudHasMore = ref(false);
  /** 我喜欢的音乐 ID 集合（网易云红心） */
  const likedSongIds = ref<Set<number>>(new Set());

  // ---- 登录弹窗 ----
  const qrOpen = ref(false);
  const qrKey = ref("");
  const qrCode = ref("");
  const qrState = ref<QrState>("wait");
  const qrError = ref("");
  let pollTimer: number | null = null;
  let qrDeadline = 0;

  // 手机号登录弹窗状态
  const authTab = ref<"qr" | "phone">("qr");
  const phone = ref("");
  const smsCode = ref("");
  const smsSending = ref(false);
  const smsCooldown = ref(0);
  const phoneLogging = ref(false);
  const phoneError = ref("");
  let smsCooldownTimer: number | null = null;

  /** 应用启动 / 设置开启时校验登录态并拉取歌单与云盘数量 */
  async function init() {
    if (!useSettingsStore().neteaseEnabled) return;
    try {
      profile.value = await capabilities.neteaseAccount();
      loggedIn.value = true;
      void refreshPlaylists();
      void refreshCloudCount();
      void refreshLikedSongs();
    } catch {
      loggedIn.value = false;
      profile.value = null;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      clearTimeout(pollTimer);
      pollTimer = null;
    }
  }

  /** 打开扫码弹窗：取 unikey → 生成二维码 → 开始轮询 */
  async function openQr() {
    qrOpen.value = true;
    qrState.value = "wait";
    qrError.value = "";
    qrDeadline = Date.now() + 120_000;
    try {
      const key = await capabilities.neteaseLoginQrKey();
      qrKey.value = key;
      qrCode.value = await QRCode.toDataURL(
        `https://music.163.com/login?codekey=${key}`,
        { width: 224, margin: 1, errorCorrectionLevel: "M" },
      );
      poll();
    } catch (e) {
      qrState.value = "error";
      qrError.value = String(e);
    }
  }

  function poll() {
    stopPolling();
    pollTimer = window.setTimeout(async () => {
      if (Date.now() > qrDeadline) {
        qrState.value = "timeout";
        return;
      }
      try {
        const res = await capabilities.neteaseLoginQrCheck(qrKey.value);
        if (res.code === 803) {
          qrState.value = "success";
          loggedIn.value = true;
          profile.value = {
            userId: 0,
            nickname: res.nickname ?? "",
            avatarUrl: res.avatarUrl ?? "",
          };
          // 拉完整账号信息（头像等），失败不阻塞
          try {
            profile.value = await capabilities.neteaseAccount();
          } catch {
            /* 保留扫码返回的昵称 */
          }
          closeQr();
          void refreshPlaylists();
          void refreshCloudCount();
          void refreshLikedSongs();
          return;
        }
        // 实测语义：801=等待扫码 802=已扫码待确认 800=二维码过期（停止轮询）
        if (res.code === 802) qrState.value = "confirmed";
        else if (res.code === 801) qrState.value = "wait";
        else if (res.code === 800) {
          qrState.value = "timeout";
          return;
        } else qrState.value = "wait";
        poll();
      } catch (e) {
        qrState.value = "error";
        qrError.value = String(e);
      }
    }, qrState.value === "confirmed" ? POLL_CONFIRMED_INTERVAL : POLL_INTERVAL);
  }

  function closeQr() {
    stopPolling();
    if (smsCooldownTimer) {
      clearTimeout(smsCooldownTimer);
      smsCooldownTimer = null;
    }
    qrOpen.value = false;
    qrKey.value = "";
    qrCode.value = "";
    qrState.value = "wait";
    smsCooldown.value = 0;
    phone.value = "";
    smsCode.value = "";
    phoneError.value = "";
    authTab.value = "qr";
  }

  /** 发送短信验证码 */
  async function sendSmsCaptcha() {
    if (smsSending.value || smsCooldown.value > 0) return;
    if (!/^\d{11}$/.test(phone.value.trim())) {
      phoneError.value = "请输入 11 位手机号";
      return;
    }
    phoneError.value = "";
    smsSending.value = true;
    try {
      await capabilities.neteaseSmsCaptchaSent(phone.value.trim());
      smsCooldown.value = 60;
      smsCooldownTimer = window.setInterval(() => {
        smsCooldown.value--;
        if (smsCooldown.value <= 0) {
          if (smsCooldownTimer) {
            clearInterval(smsCooldownTimer);
            smsCooldownTimer = null;
          }
        }
      }, 1000);
    } catch (e) {
      phoneError.value = String(e);
    } finally {
      smsSending.value = false;
    }
  }

  /** 手机号验证码登录 */
  async function phoneLogin() {
    if (phoneLogging.value) return;
    if (!/^\d{11}$/.test(phone.value.trim())) {
      phoneError.value = "请输入 11 位手机号";
      return;
    }
    if (!smsCode.value.trim()) {
      phoneError.value = "请输入验证码";
      return;
    }
    phoneError.value = "";
    phoneLogging.value = true;
    try {
      const account = await capabilities.neteaseLoginCellphone(phone.value.trim(), smsCode.value.trim());
      loggedIn.value = true;
      profile.value = account;
      closeQr();
      void refreshPlaylists();
      void refreshCloudCount();
      void refreshLikedSongs();
    } catch (e) {
      phoneError.value = String(e);
    } finally {
      phoneLogging.value = false;
    }
  }

  /** 退出登录：清 Rust 侧 cookie + 本地状态 */
  async function logout() {
    try {
      await capabilities.neteaseLogout();
    } catch {
      /* 忽略清理失败 */
    }
    loggedIn.value = false;
    profile.value = null;
    playlists.value = [];
    cloudCount.value = 0;
    cloudHasMore.value = false;
    likedSongIds.value = new Set();
    clearSongUrlCache();
  }

  async function refreshPlaylists() {
    try {
      playlists.value = await capabilities.neteaseUserPlaylists(0, 100);
    } catch (e) {
      console.warn("[网易云] 歌单拉取失败:", e);
    }
  }

  async function refreshCloudCount() {
    try {
      const page = await capabilities.neteaseCloud(0, 1);
      cloudCount.value = page.count;
    } catch (e) {
      console.warn("[网易云] 云盘数量拉取失败:", e);
    }
  }

  /** 云盘分页：返回新页歌曲，同时更新 hasMore/count */
  async function loadCloudPage(offset: number): Promise<NeteaseSong[]> {
    const page = await capabilities.neteaseCloud(offset, 50);
    cloudHasMore.value = page.hasMore;
    cloudCount.value = page.count;
    return page.songs;
  }

  /** 拉取我喜欢的音乐 ID 列表（登录后调用） */
  async function refreshLikedSongs() {
    if (!loggedIn.value || !profile.value) return;
    try {
      likedSongIds.value = new Set(await capabilities.neteaseLikelist(profile.value.userId));
    } catch (e) {
      console.warn("[网易云] 红心列表拉取失败:", e);
    }
  }

  function isSongLiked(id: number | string): boolean {
    const n = Number(id);
    if (!Number.isFinite(n)) return false;
    return likedSongIds.value.has(n);
  }

  /** 红心 / 取消红心，返回操作后的状态 */
  async function toggleSongLiked(id: number | string): Promise<boolean> {
    const n = Number(id);
    if (!Number.isFinite(n) || !loggedIn.value) return false;
    const next = !likedSongIds.value.has(n);
    // 乐观更新，失败回滚
    const prev = new Set(likedSongIds.value);
    if (next) likedSongIds.value.add(n);
    else likedSongIds.value.delete(n);
    try {
      await capabilities.neteaseSetSongLiked(n, next);
      return next;
    } catch (e) {
      likedSongIds.value = prev;
      console.warn("[网易云] 红心操作失败:", e);
      return !next;
    }
  }

  return {
    loggedIn,
    profile,
    playlists,
    cloudCount,
    cloudHasMore,
    qrOpen,
    qrCode,
    qrState,
    qrError,
    authTab,
    phone,
    smsCode,
    smsSending,
    smsCooldown,
    phoneLogging,
    phoneError,
    init,
    openQr,
    closeQr,
    logout,
    sendSmsCaptcha,
    phoneLogin,
    refreshPlaylists,
    refreshCloudCount,
    loadCloudPage,
    likedSongIds,
    isSongLiked,
    toggleSongLiked,
    refreshLikedSongs,
  };
});