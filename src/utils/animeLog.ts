/**
 * 在线番剧链路诊断日志（前缀 [anime-online]，落 %TEMP%/lumiluna_login_debug.log）。
 *
 * 规则源 = 外部数据 + 外部站点，失败原因（站点改版 / 被墙 / 反爬 / XPath 失配）
 * 从 UI 完全看不出来，必须落文件（白屏/闪退时 console 读不到）。
 * 抽成独立模块：store 与 fetcher 都要用，避免循环依赖。
 *
 * 日志写失败绝不能阻塞检索/播放主流程。
 */
import { capabilities } from "@/capabilities";

export function animeLog(msg: string): void {
  try {
    const p = capabilities.appLog(`[anime-online] ${msg}`);
    if (p && typeof (p as Promise<void>).catch === "function") {
      void (p as Promise<void>).catch(() => {});
    }
  } catch {
    /* 忽略：日志不可用不影响功能 */
  }
}
