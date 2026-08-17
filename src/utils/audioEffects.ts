/**
 * Web Audio 音效引擎。
 *
 * 说明：
 * - 使用 `createMediaElementSource` 把全局 `<audio>` 接入 AudioContext。
 * - 节点链：source → input → EQ/低音增强 → 混响 → 立体声宽度 → output → destination。
 * - 关闭音效时不会销毁节点（同一个 media element 只能创建一次 source），
 *   而是切换到 bypass 直通路径，保证以后还能无损重新开启。
 * - 只有用户首次开启音效时才创建 AudioContext；未开启时保持原生直通播放，
 *   避免 Web Audio 对跨域/本地协议的未知影响。
 */
import type { AudioEffectConfig, EqBand } from "@shared/types";

/** 默认 10 段 EQ 频点 */
export const DEFAULT_EQ_BANDS: EqBand[] = [
  { frequency: 31, gain: 0 },
  { frequency: 62, gain: 0 },
  { frequency: 125, gain: 0 },
  { frequency: 250, gain: 0 },
  { frequency: 500, gain: 0 },
  { frequency: 1000, gain: 0 },
  { frequency: 2000, gain: 0 },
  { frequency: 4000, gain: 0 },
  { frequency: 8000, gain: 0 },
  { frequency: 16000, gain: 0 },
];

const EQ_Q = 1;
const REVERB_SECONDS = 1.8;
const REVERB_DECAY = 3;

export class AudioEffectEngine {
  private ctx: AudioContext | null = null;
  private media: HTMLAudioElement | null = null;

  private input: GainNode | null = null;
  private output: GainNode | null = null;
  private bypass: GainNode | null = null;
  private effectMix: GainNode | null = null;

  private eqFilters: BiquadFilterNode[] = [];
  private bassFilter: BiquadFilterNode | null = null;

  private dryGain: GainNode | null = null;
  private wetGain: GainNode | null = null;
  private convolver: ConvolverNode | null = null;

  private widthGains: {
    lOut0: GainNode;
    lOut1: GainNode;
    rOut0: GainNode;
    rOut1: GainNode;
  } | null = null;

  get attached(): boolean {
    return this.ctx !== null;
  }

  attach(media: HTMLAudioElement): void {
    if (this.ctx) return;
    const Ctx: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    const ctx = new Ctx();
    const source = ctx.createMediaElementSource(media);
    const input = ctx.createGain();
    const output = ctx.createGain();
    const bypass = ctx.createGain();
    const effectMix = ctx.createGain();

    source.connect(input);
    input.connect(bypass);
    bypass.connect(output);
    output.connect(ctx.destination);

    // EQ 链
    let prev: AudioNode = input;
    for (const band of DEFAULT_EQ_BANDS) {
      const filter = ctx.createBiquadFilter();
      filter.type =
        band.frequency === DEFAULT_EQ_BANDS[0].frequency
          ? "lowshelf"
          : band.frequency === DEFAULT_EQ_BANDS[DEFAULT_EQ_BANDS.length - 1].frequency
            ? "highshelf"
            : "peaking";
      filter.frequency.value = band.frequency;
      filter.Q.value = EQ_Q;
      filter.gain.value = band.gain;
      prev.connect(filter);
      prev = filter;
      this.eqFilters.push(filter);
    }

    const bass = ctx.createBiquadFilter();
    bass.type = "lowshelf";
    bass.frequency.value = 120;
    bass.gain.value = 0;
    prev.connect(bass);

    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, REVERB_SECONDS, REVERB_DECAY);
    bass.connect(dry);
    bass.connect(convolver);
    convolver.connect(wet);

    const sum = ctx.createGain();
    dry.connect(sum);
    wet.connect(sum);

    // 立体声宽度（mid/side 简易实现）
    const splitter = ctx.createChannelSplitter(2);
    const merger = ctx.createChannelMerger(2);
    const lOut0 = ctx.createGain();
    const lOut1 = ctx.createGain();
    const rOut0 = ctx.createGain();
    const rOut1 = ctx.createGain();
    sum.connect(splitter);
    splitter.connect(lOut0, 0, 0);
    splitter.connect(lOut1, 0, 0);
    splitter.connect(rOut0, 1, 0);
    splitter.connect(rOut1, 1, 0);
    lOut0.connect(merger, 0, 0);
    lOut1.connect(merger, 0, 1);
    rOut0.connect(merger, 0, 0);
    rOut1.connect(merger, 0, 1);
    merger.connect(effectMix);
    effectMix.connect(output);

    this.ctx = ctx;
    this.media = media;
    this.input = input;
    this.output = output;
    this.bypass = bypass;
    this.effectMix = effectMix;
    this.bassFilter = bass;
    this.dryGain = dry;
    this.wetGain = wet;
    this.convolver = convolver;
    this.widthGains = { lOut0, lOut1, rOut0, rOut1 };
  }

  update(config: AudioEffectConfig): void {
    if (!this.ctx) return;

    // 启用/旁通
    if (this.bypass && this.effectMix) {
      this.bypass.gain.value = config.enabled ? 0 : 1;
      this.effectMix.gain.value = config.enabled ? 1 : 0;
    }

    // EQ
    config.eqBands.forEach((band, i) => {
      this.eqFilters[i]?.gain.setTargetAtTime(band.gain, this.ctx!.currentTime, 0.03);
    });

    // 低音增强
    this.bassFilter?.gain.setTargetAtTime(
      config.bassBoost,
      this.ctx.currentTime,
      0.03,
    );

    // 混响干湿比
    const reverb = Math.max(0, Math.min(100, config.reverb));
    const dryValue = 1 - reverb / 100;
    const wetValue = reverb / 100;
    this.dryGain?.gain.setTargetAtTime(dryValue, this.ctx.currentTime, 0.03);
    this.wetGain?.gain.setTargetAtTime(wetValue, this.ctx.currentTime, 0.03);

    // 立体声宽度：0=单声道，50=原始，100=加宽
    const width = Math.max(0, Math.min(100, config.stereoWidth)) / 100;
    const factor = width * 2;
    const gLL = (1 + factor) / 2;
    const gLR = (1 - factor) / 2;
    const gRL = (1 - factor) / 2;
    const gRR = (1 + factor) / 2;
    if (this.widthGains) {
      this.widthGains.lOut0.gain.setTargetAtTime(gLL, this.ctx.currentTime, 0.03);
      this.widthGains.lOut1.gain.setTargetAtTime(gLR, this.ctx.currentTime, 0.03);
      this.widthGains.rOut0.gain.setTargetAtTime(gRL, this.ctx.currentTime, 0.03);
      this.widthGains.rOut1.gain.setTargetAtTime(gRR, this.ctx.currentTime, 0.03);
    }
  }

  resume(): void {
    if (this.ctx && this.ctx.state === "suspended") {
      void this.ctx.resume().catch(() => {});
    }
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === "running") {
      void this.ctx.suspend().catch(() => {});
    }
  }

  private makeImpulse(
    ctx: AudioContext,
    seconds: number,
    decay: number,
  ): AudioBuffer {
    const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
      }
    }
    return buffer;
  }
}

/** 全局单例音效引擎 */
export const audioEffectEngine = new AudioEffectEngine();