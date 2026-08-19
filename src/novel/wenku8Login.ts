// Wenku8 登录流程（方案A：内嵌 WebView 抓 cookie）
// 移植自参考项目 Flutter Hikari Novel 的登录机制：
//   1. 打开 Wenku8 登录页（用户在网页内输入账号密码完成登录）
//   2. 参考项目在 WebView 中注入 JS，删除 usecookie=0 选项，确保拿到持久登录态
//   3. 登录成功后页面 cookie 中出现 jieqiUserInfo + jieqiVisitInfo
//   4. 注入脚本读取 document.cookie 并直接 invoke Rust 命令提交、关闭窗口
//
// 注：Tauri v2 已移除前端 Webview.eval，注入脚本由 Rust 侧通过
// WebviewWindowBuilder.initialization_script 在窗口创建时注入（无 eval 权限需求）。

import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Wenku8LoginStatus } from "@shared/types";

// 超时（毫秒）：10 分钟
const TIMEOUT = 10 * 60 * 1000;

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

  const { capabilities } = await import("@/capabilities");
  // 由 Rust 侧创建窗口并注入脚本（含 initialization_script）
  await capabilities.wenku8LoginOpen();

  // 等待窗口创建后再监听关闭
  let win: WebviewWindow | null = await WebviewWindow.getByLabel(label);
  const start = Date.now();
  await new Promise<void>((resolve) => {
    let settled = false;
    const onClose = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    if (win) {
      // 关闭请求：默认即会关闭窗口；显式调用 close() 兜底，确保系统“X”一定生效
      win
        .onCloseRequested(() => {
          win.close().catch(() => {});
          onClose();
        })
        .catch(() => onClose());
      win.once("destroyed", onClose);
    }
    // 超时兜底：强制关闭
    const watchdog = setInterval(() => {
      if (Date.now() - start > TIMEOUT) {
        clearInterval(watchdog);
        win?.close().catch(() => {});
        onClose();
      }
    }, 1000);
  });

  // 重新查询登录状态确认是否成功
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
