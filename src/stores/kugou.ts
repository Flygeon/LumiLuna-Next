/**
 * 酷狗账号 store：登录态、扫码 / 手机号登录弹窗状态、每日签到（畅听 VIP + 概念版）。
 *
 * 请求全走 Rust 命令（`kugou_server::bridge` 进程内直调上游路由表），凭据由
 * Rust 侧持有；浏览器预览由 `capabilities/mock.ts` 提供空态支撑。
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import QRCode from "qrcode";
import { capabilities } from "@/capabilities";
import { useSettingsStore } from "@/stores/settings";
import { clearKugouUrlCache } from "@/utils/kugou";
import type { KugouProfile } from "@shared/types";

/** 扫码轮询间隔 */
const POLL_INTERVAL = 2000;
/** 二维码有效期（上游约 2 分钟） */
const QR_TTL_MS = 120_000;

export type KugouQrState = "wait" | "scanned" | "success" | "timeout" | "error";

export const useKugouStore = defineStore("kugou", () => {
  const loggedIn = ref(false);
  const profile = ref<KugouProfile | null>(null);
  /** 已签到日期（`YYYY-MM-DD`） */
  const signedDays = ref<string[]>([]);

  /** 本地日期（与 Rust 侧签到日期口径一致；两者都按中国区判定） */
  function todayKey(): string {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /** 今天是否已签到（供签到入口显示状态） */
  const signedToday = computed(() => signedDays.value.includes(todayKey()));

  // ---- 签到 ----
  const signing = ref(false);
  const signInMessage = ref("");
  /** 需要二次安全验证（error_code=20028） */
  const needVerify = ref(false);

  // ---- 登录弹窗 ----
  const qrOpen = ref(false);
  const authTab = ref<"qr" | "phone">("qr");
  const qrCode = ref("");
  const qrState = ref<KugouQrState>("wait");
  const qrError = ref("");
  let pollTimer: number | null = null;
  let qrDeadline = 0;
  let qrKey = "";

  // ---- 手机号登录 ----
  const phone = ref("");
  const smsCode = ref("");
  const smsSending = ref(false);
  const smsCooldown = ref(0);
  const phoneLogging = ref(false);
  const phoneError = ref("");
  let smsCooldownTimer: number | null = null;

  /** 应用启动 / 设置开启时恢复登录态（本地读取，不发网络请求） */
  async function init() {
    if (!useSettingsStore().kugouEnabled) return;
    await refreshStatus();
  }

  async function refreshStatus() {
    try {
      const st = await capabilities.kugouLoginStatus();
      // 浏览器预览 / 极端情况下可能返回 null，按未登录处理
      if (!st) return;
      loggedIn.value = st.loggedIn;
      profile.value = st.profile ?? null;
      signedDays.value = st.signedDays ?? [];
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

  /** 打开扫码弹窗：取 key → 生成二维码 → 开始轮询 */
  async function openQr() {
    qrOpen.value = true;
    qrState.value = "wait";
    qrError.value = "";
    qrCode.value = "";
    qrDeadline = Date.now() + QR_TTL_MS;
    try {
      const { key, url } = await capabilities.kugouLoginQrKey();
      qrKey = key;
      qrCode.value = await QRCode.toDataURL(url, {
        width: 224,
        margin: 1,
        errorCorrectionLevel: "M",
      });
      poll();
    } catch (e) {
      qrState.value = "error";
      qrError.value = e instanceof Error ? e.message : String(e);
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
        const res = await capabilities.kugouLoginQrCheck(qrKey);
        // 上游状态：1=等待扫码 2/803=已扫码待确认 4=登录成功 0/800=二维码过期
        if (res.status === 4) {
          qrState.value = "success";
          loggedIn.value = true;
          profile.value = res.profile ?? null;
          stopPolling();
          await refreshStatus();
          await autoSignInIfNeeded();
          window.setTimeout(() => closeQr(), 600);
          return;
        }
        if (res.status === 0 || res.status === 800) {
          qrState.value = "timeout";
          return;
        }
        qrState.value = res.status === 2 || res.status === 803 ? "scanned" : "wait";
        poll();
      } catch (e) {
        qrState.value = "error";
        qrError.value = e instanceof Error ? e.message : String(e);
      }
    }, POLL_INTERVAL);
  }

  function closeQr() {
    stopPolling();
    if (smsCooldownTimer) {
      clearInterval(smsCooldownTimer);
      smsCooldownTimer = null;
    }
    qrOpen.value = false;
    qrKey = "";
    qrCode.value = "";
    qrState.value = "wait";
    qrError.value = "";
    smsCooldown.value = 0;
    phone.value = "";
    smsCode.value = "";
    phoneError.value = "";
    authTab.value = "qr";
  }

  /** 登录后自动签到（设置开关控制；今日已签则跳过） */
  async function autoSignInIfNeeded() {
    if (!useSettingsStore().kugouAutoSignIn) return;
    if (signedToday.value) return;
    await signIn();
  }

  /** 发送短信验证码 */
  async function sendSms() {
    if (smsSending.value || smsCooldown.value > 0) return;
    const mobile = phone.value.trim();
    if (!/^\d{11}$/.test(mobile)) {
      phoneError.value = "请输入 11 位手机号";
      return;
    }
    phoneError.value = "";
    smsSending.value = true;
    try {
      await capabilities.kugouCaptchaSent(mobile);
      smsCooldown.value = 60;
      smsCooldownTimer = window.setInterval(() => {
        smsCooldown.value--;
        if (smsCooldown.value <= 0 && smsCooldownTimer) {
          clearInterval(smsCooldownTimer);
          smsCooldownTimer = null;
        }
      }, 1000);
    } catch (e) {
      phoneError.value = e instanceof Error ? e.message : String(e);
    } finally {
      smsSending.value = false;
    }
  }

  /** 手机号 + 验证码登录 */
  async function phoneLogin() {
    if (phoneLogging.value) return;
    const mobile = phone.value.trim();
    if (!/^\d{11}$/.test(mobile)) {
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
      profile.value = await capabilities.kugouLoginCellphone(mobile, smsCode.value.trim());
      loggedIn.value = true;
      closeQr();
      await refreshStatus();
      await autoSignInIfNeeded();
    } catch (e) {
      phoneError.value = e instanceof Error ? e.message : String(e);
    } finally {
      phoneLogging.value = false;
    }
  }

  /** 每日签到：领取畅听 VIP → 升级概念版 */
  async function signIn() {
    if (signing.value) return;
    signing.value = true;
    signInMessage.value = "";
    needVerify.value = false;
    try {
      const res = await capabilities.kugouSignIn();
      if (res.ssaCode) {
        needVerify.value = true;
        signInMessage.value = "需要安全验证：请在酷狗 App 内完成验证后重试";
        return;
      }
      signInMessage.value = res.message;
      if (res.ok) await refreshStatus();
    } catch (e) {
      signInMessage.value = e instanceof Error ? e.message : String(e);
    } finally {
      signing.value = false;
    }
  }

  /** 退出登录：清 Rust 侧账号凭据 + 本地状态 */
  async function logout() {
    try {
      await capabilities.kugouLogout();
    } catch {
      /* 忽略清理失败 */
    }
    loggedIn.value = false;
    profile.value = null;
    signedDays.value = [];
    signInMessage.value = "";
    needVerify.value = false;
    clearKugouUrlCache();
  }

  return {
    loggedIn,
    profile,
    signedDays,
    signedToday,
    signing,
    signInMessage,
    needVerify,
    qrOpen,
    authTab,
    qrCode,
    qrState,
    qrError,
    phone,
    smsCode,
    smsSending,
    smsCooldown,
    phoneLogging,
    phoneError,
    init,
    refreshStatus,
    openQr,
    closeQr,
    sendSms,
    phoneLogin,
    signIn,
    logout,
  };
});
