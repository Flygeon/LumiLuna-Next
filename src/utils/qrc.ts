/**
 * QQ 音乐 QRC 逐字歌词：3DES 解密 + zlib 解压 + QRC 解析。
 *
 * 移植自 LDDC（Lyrics Downloader Decryptor Converter），原作者 沉默の金 (cmzj@cmzj.org)：
 *   - LDDC/core/decryptor/tripledes.py           （3DES 实现，参考 QQMusicDecoder C# 版）
 *   - LDDC/core/decryptor/__init__.py::qrc_decrypt
 *   - LDDC/core/parser/qrc.py::qrc2data / qrc_str_parse
 * 原项目 SPDX-License-Identifier: GPL-3.0-only
 *
 * 注意：Python 的 >> 作用于无符号位模式；JS 位运算为 int32，凡涉及高位一律用 >>>。
 */
import pako from "pako";
import type { LyricLine, WordUnit } from "@shared/types";

// ==================== 3DES（QQ 系，ECB 每 8 字节一块） ====================

const ENCRYPT = 1;
const DECRYPT = 0;

const SBOX: number[][] = [
  // sbox1
  [14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7,
   0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12, 11, 9, 5, 3, 8,
   4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0,
   15, 12, 8, 2, 4, 9, 1, 7, 5, 11, 3, 14, 10, 0, 6, 13],
  // sbox2
  [15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10,
   3, 13, 4, 7, 15, 2, 8, 15, 12, 0, 1, 10, 6, 9, 11, 5,
   0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15,
   13, 8, 10, 1, 3, 15, 4, 2, 11, 6, 7, 12, 0, 5, 14, 9],
  // sbox3
  [10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8,
   13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5, 14, 12, 11, 15, 1,
   13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7,
   1, 10, 13, 0, 6, 9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12],
  // sbox4
  [7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15,
   13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2, 12, 1, 10, 14, 9,
   10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4,
   3, 15, 0, 6, 10, 10, 13, 8, 9, 4, 5, 11, 12, 7, 2, 14],
  // sbox5
  [2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9,
   14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15, 10, 3, 9, 8, 6,
   4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14,
   11, 8, 12, 7, 1, 14, 2, 13, 6, 15, 0, 9, 10, 4, 5, 3],
  // sbox6
  [12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11,
   10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13, 14, 0, 11, 3, 8,
   9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6,
   4, 3, 2, 12, 9, 5, 15, 10, 11, 14, 1, 7, 6, 0, 8, 13],
  // sbox7
  [4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1,
   13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5, 12, 2, 15, 8, 6,
   1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2,
   6, 11, 13, 8, 1, 4, 10, 7, 9, 5, 0, 15, 14, 2, 3, 12],
  // sbox8
  [13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7,
   1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6, 11, 0, 14, 9, 2,
   7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8,
   2, 1, 14, 7, 4, 10, 8, 13, 15, 12, 9, 0, 3, 5, 6, 11],
];

/** 从字节串中提取指定位置的位，并左移指定偏移量 */
function bitnum(a: Uint8Array, b: number, c: number): number {
  return ((a[Math.floor(b / 32) * 4 + 3 - Math.floor((b % 32) / 8)] >> (7 - (b % 8))) & 1) << c;
}

/** 从整数中提取指定位置的位（右移取位），并左移指定偏移量 */
function bitnumIntr(a: number, b: number, c: number): number {
  return ((a >>> (31 - b)) & 1) << c;
}

/** 从整数中提取指定位置的位（左移取位），并右移指定偏移量 */
function bitnumIntl(a: number, b: number, c: number): number {
  return ((a << b) & 0x80000000) >>> c;
}

function sboxBit(a: number): number {
  return (a & 32) | ((a & 31) >> 1) | ((a & 1) << 4);
}

function initialPermutation(inputData: Uint8Array): [number, number] {
  return [
    (bitnum(inputData, 57, 31) | bitnum(inputData, 49, 30) | bitnum(inputData, 41, 29) | bitnum(inputData, 33, 28) |
     bitnum(inputData, 25, 27) | bitnum(inputData, 17, 26) | bitnum(inputData, 9, 25) | bitnum(inputData, 1, 24) |
     bitnum(inputData, 59, 23) | bitnum(inputData, 51, 22) | bitnum(inputData, 43, 21) | bitnum(inputData, 35, 20) |
     bitnum(inputData, 27, 19) | bitnum(inputData, 19, 18) | bitnum(inputData, 11, 17) | bitnum(inputData, 3, 16) |
     bitnum(inputData, 61, 15) | bitnum(inputData, 53, 14) | bitnum(inputData, 45, 13) | bitnum(inputData, 37, 12) |
     bitnum(inputData, 29, 11) | bitnum(inputData, 21, 10) | bitnum(inputData, 13, 9) | bitnum(inputData, 5, 8) |
     bitnum(inputData, 63, 7) | bitnum(inputData, 55, 6) | bitnum(inputData, 47, 5) | bitnum(inputData, 39, 4) |
     bitnum(inputData, 31, 3) | bitnum(inputData, 23, 2) | bitnum(inputData, 15, 1) | bitnum(inputData, 7, 0)),
    (bitnum(inputData, 56, 31) | bitnum(inputData, 48, 30) | bitnum(inputData, 40, 29) | bitnum(inputData, 32, 28) |
     bitnum(inputData, 24, 27) | bitnum(inputData, 16, 26) | bitnum(inputData, 8, 25) | bitnum(inputData, 0, 24) |
     bitnum(inputData, 58, 23) | bitnum(inputData, 50, 22) | bitnum(inputData, 42, 21) | bitnum(inputData, 34, 20) |
     bitnum(inputData, 26, 19) | bitnum(inputData, 18, 18) | bitnum(inputData, 10, 17) | bitnum(inputData, 2, 16) |
     bitnum(inputData, 60, 15) | bitnum(inputData, 52, 14) | bitnum(inputData, 44, 13) | bitnum(inputData, 36, 12) |
     bitnum(inputData, 28, 11) | bitnum(inputData, 20, 10) | bitnum(inputData, 12, 9) | bitnum(inputData, 4, 8) |
     bitnum(inputData, 62, 7) | bitnum(inputData, 54, 6) | bitnum(inputData, 46, 5) | bitnum(inputData, 38, 4) |
     bitnum(inputData, 30, 3) | bitnum(inputData, 22, 2) | bitnum(inputData, 14, 1) | bitnum(inputData, 6, 0)),
  ];
}

function inversePermutation(s0: number, s1: number): Uint8Array {
  const data = new Uint8Array(8);
  data[3] = (bitnumIntr(s1, 7, 7) | bitnumIntr(s0, 7, 6) | bitnumIntr(s1, 15, 5) |
             bitnumIntr(s0, 15, 4) | bitnumIntr(s1, 23, 3) | bitnumIntr(s0, 23, 2) |
             bitnumIntr(s1, 31, 1) | bitnumIntr(s0, 31, 0));
  data[2] = (bitnumIntr(s1, 6, 7) | bitnumIntr(s0, 6, 6) | bitnumIntr(s1, 14, 5) |
             bitnumIntr(s0, 14, 4) | bitnumIntr(s1, 22, 3) | bitnumIntr(s0, 22, 2) |
             bitnumIntr(s1, 30, 1) | bitnumIntr(s0, 30, 0));
  data[1] = (bitnumIntr(s1, 5, 7) | bitnumIntr(s0, 5, 6) | bitnumIntr(s1, 13, 5) |
             bitnumIntr(s0, 13, 4) | bitnumIntr(s1, 21, 3) | bitnumIntr(s0, 21, 2) |
             bitnumIntr(s1, 29, 1) | bitnumIntr(s0, 29, 0));
  data[0] = (bitnumIntr(s1, 4, 7) | bitnumIntr(s0, 4, 6) | bitnumIntr(s1, 12, 5) |
             bitnumIntr(s0, 12, 4) | bitnumIntr(s1, 20, 3) | bitnumIntr(s0, 20, 2) |
             bitnumIntr(s1, 28, 1) | bitnumIntr(s0, 28, 0));
  data[7] = (bitnumIntr(s1, 3, 7) | bitnumIntr(s0, 3, 6) | bitnumIntr(s1, 11, 5) |
             bitnumIntr(s0, 11, 4) | bitnumIntr(s1, 19, 3) | bitnumIntr(s0, 19, 2) |
             bitnumIntr(s1, 27, 1) | bitnumIntr(s0, 27, 0));
  data[6] = (bitnumIntr(s1, 2, 7) | bitnumIntr(s0, 2, 6) | bitnumIntr(s1, 10, 5) |
             bitnumIntr(s0, 10, 4) | bitnumIntr(s1, 18, 3) | bitnumIntr(s0, 18, 2) |
             bitnumIntr(s1, 26, 1) | bitnumIntr(s0, 26, 0));
  data[5] = (bitnumIntr(s1, 1, 7) | bitnumIntr(s0, 1, 6) | bitnumIntr(s1, 9, 5) |
             bitnumIntr(s0, 9, 4) | bitnumIntr(s1, 17, 3) | bitnumIntr(s0, 17, 2) |
             bitnumIntr(s1, 25, 1) | bitnumIntr(s0, 25, 0));
  data[4] = (bitnumIntr(s1, 0, 7) | bitnumIntr(s0, 0, 6) | bitnumIntr(s1, 8, 5) |
             bitnumIntr(s0, 8, 4) | bitnumIntr(s1, 16, 3) | bitnumIntr(s0, 16, 2) |
             bitnumIntr(s1, 24, 1) | bitnumIntr(s0, 24, 0));
  return data;
}

function f(state: number, key: number[]): number {
  const t1 = (bitnumIntl(state, 31, 0) | ((state & 0xf0000000) >>> 1) | bitnumIntl(state, 4, 5) |
             bitnumIntl(state, 3, 6) | ((state & 0x0f000000) >>> 3) | bitnumIntl(state, 8, 11) |
             bitnumIntl(state, 7, 12) | ((state & 0x00f00000) >>> 5) | bitnumIntl(state, 12, 17) |
             bitnumIntl(state, 11, 18) | ((state & 0x000f0000) >>> 7) | bitnumIntl(state, 16, 23));

  const t2 = (bitnumIntl(state, 15, 0) | ((state & 0x0000f000) << 15) | bitnumIntl(state, 20, 5) |
             bitnumIntl(state, 19, 6) | ((state & 0x00000f00) << 13) | bitnumIntl(state, 24, 11) |
             bitnumIntl(state, 23, 12) | ((state & 0x000000f0) << 11) | bitnumIntl(state, 28, 17) |
             bitnumIntl(state, 27, 18) | ((state & 0x0000000f) << 9) | bitnumIntl(state, 0, 23));

  let lrgstate = [
    (t1 >>> 24) & 0x000000ff, (t1 >>> 16) & 0x000000ff, (t1 >>> 8) & 0x000000ff,
    (t2 >>> 24) & 0x000000ff, (t2 >>> 16) & 0x000000ff, (t2 >>> 8) & 0x000000ff,
  ];

  lrgstate = lrgstate.map((v, i) => v ^ key[i]);

  state = ((SBOX[0][sboxBit(lrgstate[0] >> 2)] << 28) |
           (SBOX[1][sboxBit(((lrgstate[0] & 0x03) << 4) | (lrgstate[1] >> 4))] << 24) |
           (SBOX[2][sboxBit(((lrgstate[1] & 0x0f) << 2) | (lrgstate[2] >> 6))] << 20) |
           (SBOX[3][sboxBit(lrgstate[2] & 0x3f)] << 16) |
           (SBOX[4][sboxBit(lrgstate[3] >> 2)] << 12) |
           (SBOX[5][sboxBit(((lrgstate[3] & 0x03) << 4) | (lrgstate[4] >> 4))] << 8) |
           (SBOX[6][sboxBit(((lrgstate[4] & 0x0f) << 2) | (lrgstate[5] >> 6))] << 4) |
           SBOX[7][sboxBit(lrgstate[5] & 0x3f)]);

  return (bitnumIntl(state, 15, 0) | bitnumIntl(state, 6, 1) | bitnumIntl(state, 19, 2) |
          bitnumIntl(state, 20, 3) | bitnumIntl(state, 28, 4) | bitnumIntl(state, 11, 5) |
          bitnumIntl(state, 27, 6) | bitnumIntl(state, 16, 7) | bitnumIntl(state, 0, 8) |
          bitnumIntl(state, 14, 9) | bitnumIntl(state, 22, 10) | bitnumIntl(state, 25, 11) |
          bitnumIntl(state, 4, 12) | bitnumIntl(state, 17, 13) | bitnumIntl(state, 30, 14) |
          bitnumIntl(state, 9, 15) | bitnumIntl(state, 1, 16) | bitnumIntl(state, 7, 17) |
          bitnumIntl(state, 23, 18) | bitnumIntl(state, 13, 19) | bitnumIntl(state, 31, 20) |
          bitnumIntl(state, 26, 21) | bitnumIntl(state, 2, 22) | bitnumIntl(state, 8, 23) |
          bitnumIntl(state, 18, 24) | bitnumIntl(state, 12, 25) | bitnumIntl(state, 29, 26) |
          bitnumIntl(state, 5, 27) | bitnumIntl(state, 21, 28) | bitnumIntl(state, 10, 29) |
          bitnumIntl(state, 3, 30) | bitnumIntl(state, 24, 31));
}

function crypt(inputData: Uint8Array, key: number[][]): Uint8Array {
  let [s0, s1] = initialPermutation(inputData);

  for (let idx = 0; idx < 15; idx++) {
    const previousS1 = s1;
    s1 = f(s1, key[idx]) ^ s0;
    s0 = previousS1;
  }
  s0 = f(s1, key[15]) ^ s0;

  return inversePermutation(s0, s1);
}

function keySchedule(key: Uint8Array, mode: number): number[][] {
  const schedule: number[][] = Array.from({ length: 16 }, () => [0, 0, 0, 0, 0, 0]);
  const keyRndShift = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
  const keyPermC = [56, 48, 40, 32, 24, 16, 8, 0, 57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35];
  const keyPermD = [62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 60, 52, 44, 36, 28, 20, 12, 4, 27, 19, 11, 3];
  const keyCompression = [13, 16, 10, 23, 0, 4, 2, 27, 14, 5, 20, 9, 22, 18, 11, 3, 25, 7, 15, 6, 26, 19, 12, 1, 40, 51, 30, 36,
                          46, 54, 29, 39, 50, 44, 32, 47, 43, 48, 38, 55, 33, 52, 45, 41, 49, 35, 28, 31];

  let c = 0;
  let d = 0;
  for (let i = 0; i < 28; i++) {
    c += bitnum(key, keyPermC[i], 31 - i);
    d += bitnum(key, keyPermD[i], 31 - i);
  }

  for (let i = 0; i < 16; i++) {
    c = ((c << keyRndShift[i]) | (c >>> (28 - keyRndShift[i]))) & 0xfffffff0;
    d = ((d << keyRndShift[i]) | (d >>> (28 - keyRndShift[i]))) & 0xfffffff0;

    const togen = mode === DECRYPT ? 15 - i : i;

    for (let j = 0; j < 24; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnumIntr(c, keyCompression[j], 7 - (j % 8));
    }
    for (let j = 24; j < 48; j++) {
      schedule[togen][Math.floor(j / 8)] |= bitnumIntr(d, keyCompression[j] - 27, 7 - (j % 8));
    }
  }
  return schedule;
}

/** 三密钥 3DES 密钥调度：解密序 = [key[16:], key[8:], key[0:]] */
function tripledesKeySetup(key: Uint8Array, mode: number): number[][][] {
  if (mode === ENCRYPT) {
    return [keySchedule(key.subarray(0, 8), ENCRYPT),
            keySchedule(key.subarray(8, 16), DECRYPT),
            keySchedule(key.subarray(16, 24), ENCRYPT)];
  }
  return [keySchedule(key.subarray(16, 24), DECRYPT),
          keySchedule(key.subarray(8, 16), ENCRYPT),
          keySchedule(key.subarray(0, 8), DECRYPT)];
}

function tripledesCrypt(data: Uint8Array, key: number[][][]): Uint8Array {
  let out = data;
  for (let i = 0; i < 3; i++) {
    out = crypt(out, key[i]);
  }
  return out;
}

// ==================== QMC1（本地 QRC 文件头异或） ====================

// 移植自 LDDC/core/decryptor/qmc1.py（参考 jixunmoe/qmc-decode）
const QMC1_PRIVKEY = [
  0xc3, 0x4a, 0xd6, 0xca, 0x90, 0x67, 0xf7, 0x52,
  0xd8, 0xa1, 0x66, 0x62, 0x9f, 0x5b, 0x09, 0x00,
  0xc3, 0x5e, 0x95, 0x23, 0x9f, 0x13, 0x11, 0x7e,
  0xd8, 0x92, 0x3f, 0xbc, 0x90, 0xbb, 0x74, 0x0e,
  0xc3, 0x47, 0x74, 0x3d, 0x90, 0xaa, 0x3f, 0x51,
  0xd8, 0xf4, 0x11, 0x84, 0x9f, 0xde, 0x95, 0x1d,
  0xc3, 0xc6, 0x09, 0xd5, 0x9f, 0xfa, 0x66, 0xf9,
  0xd8, 0xf0, 0xf7, 0xa0, 0x90, 0xa1, 0xd6, 0xf3,
  0xc3, 0xf3, 0xd6, 0xa1, 0x90, 0xa0, 0xf7, 0xf0,
  0xd8, 0xf9, 0x66, 0xfa, 0x9f, 0xd5, 0x09, 0xc6,
  0xc3, 0x1d, 0x95, 0xde, 0x9f, 0x84, 0x11, 0xf4,
  0xd8, 0x51, 0x3f, 0xaa, 0x90, 0x3d, 0x74, 0x47,
  0xc3, 0x0e, 0x74, 0xbb, 0x90, 0xbc, 0x3f, 0x92,
  0xd8, 0x7e, 0x11, 0x13, 0x9f, 0x23, 0x95, 0x5e,
  0xc3, 0x00, 0x09, 0x5b, 0x9f, 0x62, 0x66, 0xa1,
  0xd8, 0x52, 0xf7, 0x67, 0x90, 0xca, 0xd6, 0x4a,
];

function qmc1Decrypt(data: Uint8Array): void {
  for (let i = 0; i < data.length; i++) {
    data[i] ^= QMC1_PRIVKEY[i > 0x7fff ? (i % 0x7fff) & 0x7f : i & 0x7f];
  }
}

// ==================== QRC 解密 ====================

/** QQ 云歌词 3DES 密钥 */
const QRC_KEY = new TextEncoder().encode("!@#)(*$%123ZXC!@!@#)(NHL");

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s+/g, "");
  if (clean.length % 2 !== 0) {
    throw new Error("无效的十六进制长度");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const b = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(b)) {
      throw new Error("无效的十六进制字符");
    }
    out[i] = b;
  }
  return out;
}

/**
 * zlib 解压（pako）。
 * 注意：QRC 密文按 8 字节块 3DES 解密，末块带填充字节（trailing junk），
 * Python 的 zlib.decompress 与 pako 都会忽略流结束后的尾部数据，
 * 而浏览器原生 DecompressionStream 会报错，因此这里用 pako。
 */
function inflateZlib(data: Uint8Array): Uint8Array {
  return pako.inflate(data);
}

export interface QrcDecryptOptions {
  /** 本地 .qrc 文件格式：先做 QMC1 异或并跳过 11 字节头部；云歌词（默认）无此步骤 */
  local?: boolean;
}

/** 解密 QRC：hex 文本或原始字节 → （可选 QMC1）→ 3DES → zlib → UTF-8 明文 */
export async function qrcDecrypt(
  encrypted: string | Uint8Array,
  options?: QrcDecryptOptions,
): Promise<string> {
  if (typeof encrypted === "string") {
    if (encrypted.trim() === "") {
      throw new Error("没有可解密的数据");
    }
    encrypted = hexToBytes(encrypted);
  }
  if (encrypted.length === 0) {
    throw new Error("没有可解密的数据");
  }
  if (options?.local) {
    qmc1Decrypt(encrypted);
    encrypted = encrypted.subarray(11);
  }

  const schedule = tripledesKeySetup(QRC_KEY, DECRYPT);
  const blocks = Math.ceil(encrypted.length / 8);
  const decrypted = new Uint8Array(blocks * 8);
  for (let i = 0; i < blocks; i++) {
    const block = encrypted.subarray(i * 8, Math.min((i + 1) * 8, encrypted.length));
    const out8 = tripledesCrypt(block, schedule);
    decrypted.set(out8, i * 8);
  }

  const inflated = await inflateZlib(decrypted);
  return new TextDecoder("utf-8").decode(inflated);
}

// ==================== QRC 解析 ====================

const QRC_PATTERN = /<Lyric_1 LyricType="1" LyricContent="(.*?)"\/>/s;
const TAG_SPLIT_PATTERN = /^\[(\w+):([^\]]*)\]$/;
const LINE_SPLIT_PATTERN = /^\[(\d+),(\d+)\](.*)$/;
const WORD_SPLIT_PATTERN = /(?:\[\d+,\d+\])?((?:(?!\(\d+,\d+\)).)*)\((\d+),(\d+)\)/g;
const WORD_TIMESTAMP_PATTERN = /^\(\d+,\d+\)$/;

/** QRC 行（毫秒时间轴） */
interface QrcLine {
  /** 行起始（毫秒） */
  start: number;
  /** 行结束（毫秒） */
  end: number;
  /** 逐字单元；空数组 = 纯时间戳行 */
  words: { text: string; start: number; end: number }[];
}

/**
 * 将 QRC 文本解析为带毫秒时间轴的 QrcLine[]（移植 qrc2data）。
 * 返回 null 表示不是 QRC 格式。
 */
export function qrcToRawLines(sQrc: string): QrcLine[] | null {
  const m = QRC_PATTERN.exec(sQrc);
  if (!m || !m[1]) return null;

  const lines: QrcLine[] = [];
  for (const rawLine of m[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    const lineMatch = LINE_SPLIT_PATTERN.exec(line);
    if (lineMatch) {
      const lineStart = parseInt(lineMatch[1], 10);
      const lineDuration = parseInt(lineMatch[2], 10);
      const lineEnd = lineStart + lineDuration;
      const lineContent = lineMatch[3];

      if (
        lineContent.startsWith("(") &&
        lineContent.endsWith(")") &&
        WORD_TIMESTAMP_PATTERN.test(lineContent)
      ) {
        // 纯字时间戳行（无文本），保持空 words
        lines.push({ start: lineStart, end: lineEnd, words: [] });
        continue;
      }

      const words: QrcLine["words"] = [];
      WORD_SPLIT_PATTERN.lastIndex = 0;
      let wm: RegExpExecArray | null;
      while ((wm = WORD_SPLIT_PATTERN.exec(lineContent)) !== null) {
        const content = wm[1];
        if (content === "\r") continue;
        const start = parseInt(wm[2], 10);
        const duration = parseInt(wm[3], 10);
        words.push({ text: content, start, end: start + duration });
      }
      if (!words.length) {
        words.push({ text: lineContent, start: lineStart, end: lineEnd });
      }
      lines.push({ start: lineStart, end: lineEnd, words });
    } else {
      const tagMatch = TAG_SPLIT_PATTERN.exec(line);
      if (tagMatch) {
        // 标签行（[ti:...] 等）：本移植不消费，跳过
        void tagMatch;
      }
    }
  }
  return lines;
}

/** 将 QRC 行转为项目的 LyricLine（秒时间轴）；纯时间戳行（空文本）跳过 */
export function rawLinesToLyricLines(lines: QrcLine[]): LyricLine[] {
  const out: LyricLine[] = [];
  for (const l of lines) {
    const text = l.words.map((w) => w.text).join("");
    if (!text.trim()) continue;
    const units: WordUnit[] = l.words.map((w) => ({
      text: w.text,
      start: w.start / 1000,
      end: w.end / 1000,
    }));
    out.push({ time: l.start / 1000, text, units });
  }
  return out;
}

/** 判断歌词是否含逐字数据（任一行字单元数 > 1） */
export function hasWordLevel(lines: LyricLine[]): boolean {
  return lines.some((l) => (l.units?.length ?? 0) > 1);
}

/**
 * 合并原文 + 翻译 + 罗马音为 LyricLine[]。
 * 各轨行数一致按索引配对，否则按行起始时间最近匹配（贪心）。
 */
export function mergeQqLyrics(
  orig: LyricLine[],
  trans: LyricLine[] | null,
  roma: LyricLine[] | null,
): LyricLine[] {
  if ((!trans || !trans.length) && (!roma || !roma.length)) return orig;

  const pairIndex = (a: LyricLine[], b: LyricLine[]): number[] => {
    if (a.length === b.length) return a.map((_, i) => i);
    // 按起始时间最近匹配
    const pairs = new Map<number, number>();
    const usedB = new Set<number>();
    const order = a
      .flatMap((la, ia) => b.map((lb, ib) => ({ ia, ib, diff: Math.abs(la.time - lb.time) })))
      .sort((x, y) => x.diff - y.diff);
    for (const { ia, ib } of order) {
      if (pairs.has(ia) || usedB.has(ib)) continue;
      pairs.set(ia, ib);
      usedB.add(ib);
      if (pairs.size === a.length || pairs.size === b.length) break;
    }
    return a.map((_, i) => pairs.get(i) ?? -1);
  };

  const transIdx = trans?.length ? pairIndex(orig, trans) : null;
  const romaIdx = roma?.length ? pairIndex(orig, roma) : null;
  return orig.map((line, i) => {
    let out = line;
    if (transIdx) {
      const ti = transIdx[i];
      if (ti >= 0 && trans![ti].text) {
        out = { ...out, translation: trans![ti].text };
      }
    }
    if (romaIdx) {
      const ri = romaIdx[i];
      if (ri >= 0 && roma![ri].text) {
        out = { ...out, romaji: roma![ri].text };
      }
    }
    return out;
  });
}
