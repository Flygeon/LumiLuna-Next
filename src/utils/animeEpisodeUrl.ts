/**
 * 集数源站 URL 归一化（移植 Kazumi `normalizeEpisodeUrl`）。
 *
 * 把规则抓到的原始 `href`（相对路径 / 缺协议 / 带尾斜杠 / 多余噪声）转换为
 * 稳定一致的绝对 URL，作为「同一集」的身份主键（pageUrl）。规则：
 * - 去除首尾空白；空输入返回空串（调用方据此判断「无 URL」）。
 * - 相对路径基于 baseUrl 补全为绝对 URL。
 * - 与 baseUrl 同站（同 host、同显式端口）的 URL，协议统一到 baseUrl 声明
 *   的协议，避免同一集因 http/https 混用产生两个 key；跨站/不同端口保持
 *   原协议不动（部分站点仅支持 http）。
 * - 去除 path 多余尾斜杠（根路径保留）；去除空 query/fragment。
 * - 幂等：normalize(b, normalize(b, x)) === normalize(b, x)。
 */

function isHttpScheme(scheme: string): boolean {
  return scheme === "http" || scheme === "https";
}

export function normalizeEpisodeUrl(baseUrl: string, raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let base: URL | null = null;
  try {
    base = new URL(baseUrl.trim());
  } catch {
    base = null;
  }
  const hasValidBase =
    base !== null && isHttpScheme(base.protocol.replace(":", "")) && base.hostname.length > 0;

  let resolved: URL | null = null;
  try {
    const rawUrl = new URL(trimmed);
    resolved = rawUrl;
  } catch {
    // 相对路径 / 非法绝对 URL
  }
  if (resolved === null && hasValidBase) {
    try {
      resolved = new URL(trimmed, baseUrl.trim());
    } catch {
      resolved = null;
    }
  }
  if (resolved === null || resolved.hostname.length === 0) {
    return trimmed;
  }

  // 同站 URL 的协议统一到 baseUrl 声明的协议（端口以 URL 归一后的显式值为准：
  // 未显式指定/默认端口均为 ""，显式端口为数字串，两者不相等则不改写）
  const samePort = resolved.port === base!.port;
  if (
    hasValidBase &&
    isHttpScheme(resolved.protocol.replace(":", "")) &&
    resolved.protocol !== base!.protocol &&
    resolved.hostname === base!.hostname &&
    samePort
  ) {
    resolved.protocol = base!.protocol;
  }

  // 去除 path 尾斜杠（根路径除外）
  if (resolved.pathname.length > 1 && resolved.pathname.endsWith("/")) {
    resolved.pathname = resolved.pathname.replace(/\/+$/, "");
  }

  resolved.hash = "";
  if (resolved.search === "?") resolved.search = "";

  return resolved.toString();
}
