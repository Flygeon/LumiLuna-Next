/**
 * DanDanPlay 开放 API 客户端。
 *
 * 设计目标：给 LumiLuna 在线番剧播放器做弹幕数据源。参照
 * `在线播放参考/lib/request/clients/danmaku_client.dart` 与
 * `lib/request/apis/danmaku_api.dart` 实现。
 *
 * 鉴权：
 *   DanDanPlay 对只读接口不强制鉴权，但强烈建议带 X-AppId/X-Timestamp/X-Signature，
 *   否则有频率限制（实测约 30 req/min）。无凭证时仍可工作，但高频会 429。
 *   签名算法：SHA1("{appId}{appSecret}{path}{timestamp}{appSecret}")，hex 小写。
 *   凭证从 settings 读取；缺失时降级为无签名模式（仍可返回数据，便于本地调试）。
 *
 * CORS：
 *   DanDanPlay 公共端点响应 `Access-Control-Allow-Origin: *`，可从 webview 直接 fetch。
 *   若日后被反 CORS，迁到 @tauri-apps/plugin-http（已声明在 package.json）。
 */
import { useSettingsStore } from "@/stores/settings";
import { danmakuLog } from "@/utils/danmakuLog";
import type { DandanBangumi, DandanCommentResponse, DandanSearchEpisode } from "@shared/types";

const BASE = "https://api.dandanplay.net";

interface Credentials {
  appId: string;
  appSecret: string;
}

function readCredentials(): Credentials | null {
  const s = useSettingsStore();
  const id = (s.dandanAppId ?? "").trim();
  const secret = (s.dandanAppSecret ?? "").trim();
  if (!id || !secret) return null;
  return { appId: id, appSecret: secret };
}

/** SHA1 hex（Web Crypto） */
async function sha1Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 生成 DanDanPlay X-Signature */
async function sign(appId: string, appSecret: string, path: string, ts: number): Promise<string> {
  return sha1Hex(`${appId}${appSecret}${path}${ts}${appSecret}`);
}

/** 给请求附加鉴权头（无凭证时跳过） */
async function authHeaders(path: string): Promise<Record<string, string>> {
  const cred = readCredentials();
  if (!cred) return {};
  const ts = Math.floor(Date.now() / 1000);
  const sig = await sign(cred.appId, cred.appSecret, path, ts);
  return {
    "X-AppId": cred.appId,
    "X-Timestamp": String(ts),
    "X-Signature": sig,
    "X-Auth": "1",
  };
}

/** 基础 GET：带鉴权、UA、统一错误处理；非 2xx 抛错 */
async function getJson<T>(path: string): Promise<T> {
  const url = `${BASE}${path}`;
  const headers = {
    "User-Agent": "LumiLuna/1.2 (dandanplay-client)",
    ...(await authHeaders(path)),
  };
  let resp: Response;
  try {
    resp = await fetch(url, { method: "GET", headers });
  } catch (e) {
    throw new Error(`DanDanPlay 网络错误 ${path}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!resp.ok) {
    throw new Error(
      `DanDanPlay HTTP ${resp.status} ${path} (body=${(await resp.text()).slice(0, 200)})`,
    );
  }
  try {
    return (await resp.json()) as T;
  } catch (e) {
    throw new Error(
      `DanDanPlay 响应非 JSON ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

// ---- 端点封装 ----

interface RawBangumiResponse {
  bangumi?: {
    animeId: number;
    animeTitle: string;
    episodeCount?: number;
    episodes?: Array<{ episodeId: number; episodeTitle: string }>;
  } | null;
}

/** 用 bgm.tv ID 反查 DanDanPlay 的 animeId */
export async function getDandanAnimeIdByBgmId(
  bgmId: number | string,
): Promise<DandanBangumi | null> {
  const path = `/api/v2/bangumi/bgmtv/${encodeURIComponent(String(bgmId))}`;
  void danmakuLog(`bangumi/bgmtv/${bgmId} 请求`);
  try {
    const raw = await getJson<RawBangumiResponse>(path);
    const b = raw.bangumi;
    if (!b) return null;
    return {
      animeId: b.animeId,
      animeTitle: b.animeTitle,
      episodeCount: b.episodeCount ?? b.episodes?.length ?? 0,
      episodes: b.episodes,
    };
  } catch (e) {
    void danmakuLog(`bangumi/bgmtv/${bgmId} 失败: ${(e as Error).message}`);
    return null;
  }
}

/** 直接按 animeId 拿番剧详情（含 episodes 列表） */
export async function getDandanBangumi(animeId: number): Promise<DandanBangumi | null> {
  const path = `/api/v2/bangumi/${animeId}`;
  void danmakuLog(`bangumi/${animeId} 请求`);
  try {
    const raw = await getJson<RawBangumiResponse>(path);
    const b = raw.bangumi;
    if (!b) return null;
    return {
      animeId: b.animeId,
      animeTitle: b.animeTitle,
      episodeCount: b.episodeCount ?? b.episodes?.length ?? 0,
      episodes: b.episodes,
    };
  } catch (e) {
    void danmakuLog(`bangumi/${animeId} 失败: ${(e as Error).message}`);
    return null;
  }
}

/**
 * 按番剧标题 + 集标题搜 dandan 库。
 * 返回所有可能的 dandanEpisodeId（同名番多版本时可能 >1 条）。
 */
export async function searchDandanEpisodes(
  animeTitle: string,
  episodeTitle?: string,
): Promise<DandanSearchEpisode[]> {
  const q = new URLSearchParams({ anime: animeTitle });
  if (episodeTitle) q.set("episode", episodeTitle);
  const path = `/api/v2/search/episodes?${q.toString()}`;
  void danmakuLog(`search/episodes kw="${animeTitle}" ep="${episodeTitle ?? ""}"`);
  try {
    const raw = (await getJson<unknown>(path)) as
      DandanSearchEpisode[] | { episodes?: DandanSearchEpisode[] };
    if (Array.isArray(raw)) return raw;
    if (raw && Array.isArray(raw.episodes)) return raw.episodes;
    return [];
  } catch (e) {
    void danmakuLog(`search/episodes 失败: ${(e as Error).message}`);
    return [];
  }
}

/** 拉单集弹幕 */
export async function getDandanDanmaku(episodeId: number): Promise<DandanCommentResponse> {
  const path = `/api/v2/comment/${episodeId}?withRelated=true&chConvert=0`;
  void danmakuLog(`comment/${episodeId} 请求`);
  try {
    const raw = (await getJson<unknown>(path)) as {
      count?: number;
      comments?: Array<{ p: string; m: string }>;
    };
    const list = raw.comments ?? [];
    // 解析 p 字段：`"time,type,color,source"`
    const parsed = list
      .map((c): import("@shared/types").DanmakuEntry | null => {
        const parts = c.p.split(",");
        if (parts.length < 4) return null;
        const time = Number(parts[0]);
        const type = Number(parts[1]) as 1 | 4 | 5;
        const color = Number(parts[2]);
        const source = parts[3] || "";
        if (!Number.isFinite(time) || ![1, 4, 5].includes(type)) return null;
        return { time, mode: type, color, source, text: c.m };
      })
      .filter((x): x is import("@shared/types").DanmakuEntry => x !== null);
    return { count: raw.count ?? parsed.length, comments: parsed };
  } catch (e) {
    void danmakuLog(`comment/${episodeId} 失败: ${(e as Error).message}`);
    return { count: 0, comments: [] };
  }
}
