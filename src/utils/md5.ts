/**
 * 纯 JS MD5（酷狗 API 签名用）。
 * 标准 RFC 1321 实现，浏览器/WebView/Node 通用，不依赖 crypto.subtle。
 */
const S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];
const K = new Int32Array(64);
for (let i = 0; i < 64; i++) {
  K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
}

/** 循环左移 */
function rotl(x: number, c: number): number {
  return ((x << c) | (x >>> (32 - c))) | 0;
}

/** 计算 UTF-8 字符串的 MD5（小写十六进制） */
export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const len = bytes.length;
  // 填充：0x80 + 0 至 56 mod 64，最后 8 字节为位长（小端）
  const paddedLen = Math.ceil((len + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const bitLen = len * 8;
  const dv = new DataView(padded.buffer);
  dv.setUint32(paddedLen - 8, bitLen >>> 0, true);
  dv.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;

  const m = new Int32Array(16);
  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) {
      m[i] = dv.getInt32(off + i * 4, true);
    }
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }
      const x = (a + f + K[i] + m[g]) | 0;
      const tmp = d;
      d = c;
      c = b;
      b = (b + rotl(x, S[i])) | 0;
      a = tmp;
    }
    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  const out = new Uint8Array(16);
  const outDv = new DataView(out.buffer);
  outDv.setInt32(0, a0, true);
  outDv.setInt32(4, b0, true);
  outDv.setInt32(8, c0, true);
  outDv.setInt32(12, d0, true);
  return Array.from(out, (x) => x.toString(16).padStart(2, "0")).join("");
}
