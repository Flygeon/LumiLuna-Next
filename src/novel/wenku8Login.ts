// Wenku8 登录流程（方案B：主窗口轮询 Rust 读 cookie）
// 移植自参考项目 Flutter Hikari Novel 的登录机制：
//   1. 打开 Wenku8 登录页（用户在网页内输入账号密码完成登录）
//   2. 登录成功后页面 cookie 中出现 jieqiUserInfo + jieqiVisitInfo
//   3. 主窗口每 ~1.5s 轮询 wenku8_login_poll：Rust 直接读登录 webview 的
//      cookie（含 httpOnly），命中即保存登录态并自动关闭窗口
//
// 说明：注入脚本（initialization_script）仅作快速通道 + 诊断；远程 webview
// 中 window.__TAURI__ 是否可用不影响本方案（主窗口 invoke 恒可靠）。

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Wenku8LoginStatus } from "@shared/types";

// 超时（毫秒）：10 分钟
const TIMEOUT = 10 * 60 * 1000;
// 轮询间隔（毫秒）
const POLL_INTERVAL = 1500;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 打开登录窗口，轮询等待用户在网页内完成登录。
 * 登录成功后 Rust 自动保存 cookie 并关闭窗口，本函数返回登录状态。
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

  const { capabilities } = await import("@/capabilities");
  // 由 Rust 侧创建窗口并注入脚本（含 initialization_script）。
  // 注意：Rust 命令在 WebView2 加载外部页时可能因网络/代理较慢才返回，
  // 但窗口其实已经创建（可能白屏）。因此超时分支只“放行”不 reject，
  // 之后继续 await 命令本身的成败，避免窗口已出却误报“请重试”。
  const openTask = capabilities.wenku8LoginOpen();
  let openTimedOut = false;
  await Promise.race([
    openTask,
    new Promise<void>((resolve) => {
      setTimeout(() => {
        openTimedOut = true;
        resolve();
      }, 15000);
    }),
  ]);
  if (openTimedOut) {
    try {
      await openTask;
    } catch (e) {
      throw new Error("打开登录窗口失败：" + ((e as Error)?.message ?? String(e)));
    }
  }

  const win: WebviewWindow | null = await WebviewWindow.getByLabel(label);
  const start = Date.now();
  let userClosed = false;
  if (win) {
    // 注意：这里绝不能注册 win.onCloseRequested —— Tauri v2 中注册后窗口的
    // 关闭请求会被前端接管（后端 prevent 默认关闭、等 JS 端 destroy），而
    // 登录窗口加载的是远程页（wenku8.net，无 Tauri IPC），接管链走不通，
    // 表现为「点 X 没反应、登录成功后端 close 也关不掉」（桌面歌词窗曾踩过
    // 同款坑，见 useDesktopChrome）。destroyed 事件仅作加速信号，可收不到；
    // 用户取消的可靠判定走 Rust 轮询的 [WENKU8_LOGIN_CANCELLED]。
    const onClose = () => {
      userClosed = true;
      try {
        capabilities
          .wenku8LoginLog("[fe] 登录窗口已关闭（用户点 X 或登录成功自动关闭）")
          .catch(() => {});
      } catch {
        // 忽略日志上报失败
      }
    };
    win.once("destroyed", onClose);
  }

  // 轮询：Rust 直接读登录 webview 的 cookie（含 httpOnly），命中即返回成功。
  // 不依赖远程页注入脚本；用户点 X 关窗后，Rust 侧发现窗口不存在且无登录态，
  // 返回 [WENKU8_LOGIN_CANCELLED] 错误，据此结束等待。
  while (Date.now() - start < TIMEOUT) {
    try {
      const status = await capabilities.wenku8LoginPoll();
      if (status.loggedIn) return status;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("[WENKU8_LOGIN_CANCELLED]") || userClosed) {
        throw new Error("登录未完成或已取消，请重试");
      }
      /* 其它瞬时错误忽略，继续轮询 */
    }
    if (userClosed) throw new Error("登录未完成或已取消，请重试");
    await sleep(POLL_INTERVAL);
  }
  win?.destroy().catch(() => {});
  throw new Error("登录超时，请重试");
}

export function isLoginRequiredError(e: unknown): boolean {
  return typeof e === "string" && e.includes("[WENKU8_LOGIN_REQUIRED]");
}
