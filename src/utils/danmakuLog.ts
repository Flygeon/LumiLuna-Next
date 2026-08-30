/**
 * 弹幕链路诊断日志（前缀 [danmaku]，落 %TEMP%/lumiluna_login_debug.log）。
 * 项目硬性约定：新功能必须先埋可持久化日志，否则白屏/闪退读不到。
 */
import { capabilities } from "@/capabilities";

export function danmakuLog(msg: string): void {
  try {
    const p = capabilities.appLog(`[danmaku] ${msg}`);
    if (p && typeof (p as Promise<void>).catch === "function") {
      void (p as Promise<void>).catch(() => {});
    }
  } catch {
    /* 忽略 */
  }
}