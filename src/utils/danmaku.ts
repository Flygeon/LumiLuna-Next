/**
 * 弹幕解析与适配层：DanDanPlay 原始条目 → artplayer-plugin-danmuku 期望格式。
 *
 * 参考项目对照：
 *   - Flutter `lib/utils/danmaku.dart`（mergeDuplicateDanmakus 5s 窗 + "xN"）
 *   - Flutter `lib/modules/danmaku/danmaku_module.dart`（DanmakuEntry fromJson）
 *   - Flutter `lib/pages/player/controller/player_danmaku_controller.dart`
 *     （addDanmakus 按秒分组索引、播放循环按秒投放）
 *
 * artplayer-plugin-danmuku 期望的 Danmu 形状：
 *   { text: string, time?: number, mode?: 0|1|2, color?: string, border?: boolean }
 *   - mode 0=滚动 / 1=顶部 / 2=底部（与 DanDanPlay 1/5/4 对应需要重映射）
 *   - color 是 CSS 字符串（"#rrggbb"），DanDanPlay 给的是十进制 RGB int，要转换
 *   - 加载方式：load() 接受函数/Promise/数组，函数返回 Promise<Danmu[]> 也行
 */
import type { DanmakuEntry } from "@shared/types";
import { danmakuLog } from "@/utils/danmakuLog";

/** DanDanPlay 模式 → artplayer 模式 */
function mapMode(d: DanmakuEntry["mode"]): 0 | 1 | 2 {
  if (d === 4) return 1; // 底部
  if (d === 5) return 2; // 顶部
  return 0; // 默认滚动
}

/** 十进制 RGB int → "#rrggbb" */
function colorHex(intColor: number): string {
  const n = intColor & 0xffffff;
  return `#${n.toString(16).padStart(6, "0")}`;
}

/** artplayer-plugin-danmuku 期望的弹幕项（直接复用其类型路径） */
export interface ArtDanmu {
  text: string;
  time: number;
  mode: 0 | 1 | 2;
  color: string;
  border?: boolean;
}

/** 单条 DanmakuEntry → artplayer 弹幕项 */
export function toArtDanmu(d: DanmakuEntry): ArtDanmu {
  return {
    text: d.text,
    time: d.time,
    mode: mapMode(d.mode),
    color: colorHex(d.color),
    border: true,
  };
}

/** 应用时间轴偏移（毫秒）。正数：弹幕延后；负数：弹幕提前 */
export function applyTimeOffset(entries: ArtDanmu[], offsetMs: number): ArtDanmu[] {
  if (!offsetMs) return entries;
  const delta = offsetMs / 1000;
  return entries.map((d) => ({ ...d, time: Math.max(0, d.time + delta) }));
}

/**
 * 5 秒时间窗内合并重复弹幕，文本末尾追加 "xN"。
 * 照 `mergeDuplicateDanmakus` 默认实现：归一化（去标点/空白、全角转半角）后比文本。
 */
export function mergeDuplicates(entries: ArtDanmu[], windowSec = 5): ArtDanmu[] {
  if (entries.length <= 1) return entries;
  // 先按 time 升序排，方便时间窗扫描
  const sorted = [...entries].sort((a, b) => a.time - b.time);
  const norm = (s: string) =>
    s
      .replace(/[\s\u3000]+/g, "")
      .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      .replace(/[^\w\u4e00-\u9fa5]+/g, "")
      .toLowerCase();
  const out: ArtDanmu[] = [];
  for (const cur of sorted) {
    const key = norm(cur.text);
    const last = out[out.length - 1];
    if (last && norm(last.text.split(/ x\d+$/)[0]) === key && cur.time - last.time <= windowSec) {
      const m = last.text.match(/^(.*) x(\d+)$/);
      if (m) {
        last.text = `${m[1]} x${Number(m[2]) + 1}`;
      } else {
        last.text = `${last.text} x2`;
      }
    } else {
      out.push({ ...cur });
    }
  }
  return out;
}

/**
 * 按 time 秒聚合为"秒→该秒弹幕列表"索引。
 * 注意 artplayer-plugin-danmuku 内部也是按 time 排序发射的，这里多此一举？
 * 不多余——它内部用 setInterval 轮询 currentTime，索引给我们在播放循环外做"提前批量"、
 * "时间窗过滤"等扩展（参照参考项目 PlayerDanmakuController._emitDanmakusForCurrentPosition）。
 */
export function indexBySecond(entries: ArtDanmu[]): Map<number, ArtDanmu[]> {
  const idx = new Map<number, ArtDanmu[]>();
  for (const d of entries) {
    const sec = Math.floor(d.time);
    let bucket = idx.get(sec);
    if (!bucket) {
      bucket = [];
      idx.set(sec, bucket);
    }
    bucket.push(d);
  }
  return idx;
}

/**
 * 端到端：DanDanPlay 原始条目数组 → artplayer 可直接 load 的数组。
 * 包含：时间偏移、去重、按秒索引统计（不索引结果本身，按需调用）。
 */
export function adaptDandanToArt(
  raw: DanmakuEntry[],
  options: { offsetMs?: number; dedup?: boolean; dedupWindowSec?: number } = {},
): { items: ArtDanmu[]; bySecond: Map<number, ArtDanmu[]>; total: number } {
  const offsetMs = options.offsetMs ?? 0;
  const dedup = options.dedup ?? true;
  const win = options.dedupWindowSec ?? 5;

  let items = raw.map(toArtDanmu);
  if (dedup) items = mergeDuplicates(items, win);
  items = applyTimeOffset(items, offsetMs);

  const bySecond = indexBySecond(items);
  void danmakuLog(
    `适配弹幕 完成 raw=${raw.length} 去重后=${items.length} 索引秒数=${bySecond.size}`,
  );
  return { items, bySecond, total: items.length };
}
