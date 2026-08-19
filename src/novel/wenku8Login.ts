// Wenku8 登录流程（方案A：内嵌 WebView 抓 cookie）
// 移植自参考项目 Flutter Hikari Novel 的登录机制：
//   1. 打开 Wenku8 登录页（用户在网页内输入账号密码完成登录）
//   2. 参考项目在 WebView 中注入 JS，删除 usecookie=0 选项，确保拿到持久登录态
//   3. 登录成功后页面 cookie 中出现 jieqiUserInfo + jieqiVisitInfo
//   4. 注入脚本读取 document.cookie 并直接 invoke Rust 命令提交、关闭窗口
//
// 注：依赖 WebView 内的 Tauri API（window.__TAURI__.core.invoke），
// 因此登录窗口需要在 capabilities 中拥有 core:default 权限（见 default.json 的 wenku8-login-* 条目）。

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Wenku8LoginStatus } from "@shared/types";

const LOGIN_URL = "https://www.wenku8.net/login.php";

// 轮询间隔（毫秒）
const POLL_INTERVAL = 600;
// 超时（毫秒）：10 分钟
const TIMEOUT = 10 * 60 * 1000;

// 参考项目：移除 usecookie=0 选项，强制持久登录；
// 登录成功后（cookie 含两个关键字段）直接 invoke 提交并关闭窗口。
const INJECT_JS = `
(() => {
  function stripTempCookie() {
    try {
      const sel = document.querySelector('select[name="usecookie"]');
      if (sel) {
        for (const opt of Array.from(sel.options)) {
          if (opt.value === '0') opt.remove();
        }
        if (!sel.value) sel.value = '1';
      }
    } catch (e) {}
  }
  function hasAll() {
    const c = document.cookie || '';
    return c.includes('jieqiUserInfo') && c.includes('jieqiVisitInfo');
  }
  async function submit() {
    try {
      const cookie = document.cookie;
      if (window.__TAURI__ && window.__TAURI__.core) {
        await window.__TAURI__.core.invoke('wenku8_login_submit', { cookie });
      }
    } catch (e) {
      console.error('wenku8 submit failed', e);
    }
    try { window.close(); } catch (e) {}
  }
  stripTempCookie();
  if (hasAll()) { submit(); return; }
  const iv = setInterval(() => {
    stripTempCookie();
    if (hasAll()) { clearInterval(iv); submit(); }
  }, ${POLL_INTERVAL});
  setTimeout(() => clearInterval(iv), ${TIMEOUT});
})();
`;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 打开登录窗口，等待用户在网页内完成登录并抓取 cookie。
 * 成功时窗口内的脚本会自动提交并关闭；本函数等待窗口关闭后返回登录状态。
 * 用户主动关闭窗口或超时则抛错。
 */
export async function openWenku8Login(): Promise<Wenku8LoginStatus> {
  const label = `wenku8-login`;
  // 先关掉可能残留的窗口
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    try {
      await existing.close();
    } catch {
      /* ignore */
    }
  }

  const win = new WebviewWindow(label, {
    title: "登录轻小说网 Wenku8",
    url: LOGIN_URL,
    width: 440,
    height: 680,
    resizable: true,
    center: true,
  });

  // 等待窗口创建
  await new Promise<void>((resolve) => {
    win.once("webview-created", () => resolve());
    win.once("error", () => resolve());
    setTimeout(resolve, 1500);
  });

  // 周期性注入脚本（页面可能跳转重载）
  const start = Date.now();
  const iv = setInterval(() => {
    win.eval(INJECT_JS).catch(() => {});
  }, 1500);
  win.eval(INJECT_JS).catch(() => {});

  // 等待窗口关闭（登录成功或用户取消）
  await new Promise<void>((resolve) => {
    const onClose = () => {
      clearInterval(iv);
      resolve();
    };
    win.once("close-requested", onClose);
    win.once("destroyed", onClose);
    // 超时兜底
    const watchdog = setInterval(() => {
      if (Date.now() - start > TIMEOUT) {
        clearInterval(watchdog);
        clearInterval(iv);
        win.close().catch(() => {});
        resolve();
      }
    }, 1000);
  });

  // 重新查询登录状态确认是否成功
  // 通过 capabilities 查询（延迟引入避免循环依赖）
  const { capabilities } = await import("@/capabilities");
  try {
    const status = await capabilities.wenku8LoginStatus();
    if (status.loggedIn) return status;
  } catch {
    /* ignore */
  }
  throw new Error("登录未完成或已取消，请重试");
}

export function isLoginRequiredError(e: unknown): boolean {
  return typeof e === "string" && e.includes("[WENKU8_LOGIN_REQUIRED]");
}
