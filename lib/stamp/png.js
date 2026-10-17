// PNG の読み書き（Node 標準の zlib だけで動く。依存パッケージなし）
// 読み: 8bit の グレー / RGB / パレット / グレー+α / RGBA、非インターレース → RGBA の Buffer
// 書き: RGBA（colorType 6, 8bit）
'use strict';
const zlib = require('node:zlib');

const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// CRC32 テーブル
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf, start, end) {
  let c = -1;
  for (let i = start || 0; i < (end == null ? buf.length : end); i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

/** チャンクを列挙する */
function readChunks(buf) {
  if (!buf || buf.length < 8 || !buf.subarray(0, 8).equals(SIG)) throw new Error('PNG ではありません');
  const out = [];
  let p = 8;
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    const data = buf.subarray(p + 8, p + 8 + len);
    out.push({ type, data });
    p += 12 + len;
    if (type === 'IEND') break;
  }
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** PNG → { width, height, data: RGBA Buffer } */
function decode(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  if (!ihdr) throw new Error('IHDR がありません');
  const width = ihdr.data.readUInt32BE(0), height = ihdr.data.readUInt32BE(4);
  const depth = ihdr.data[8], colorType = ihdr.data[9], interlace = ihdr.data[12];
  if (depth !== 8) throw new Error(`未対応のビット深度: ${depth}`);
  if (interlace) throw new Error('インターレース PNG は未対応');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`未対応のカラータイプ: ${colorType}`);
  let palette = null, trns = null;
  for (const c of chunks) {
    if (c.type === 'PLTE') palette = c.data;
    if (c.type === 'tRNS') trns = c.data;
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  const raw = zlib.inflateSync(idat);
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  let prev = Buffer.alloc(stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const line = Buffer.from(raw.subarray(rp, rp + stride));
    rp += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) v += paeth(a, b, c);
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4, s = x * channels;
      if (colorType === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
      else if (colorType === 2) {
        out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2];
        out[o + 3] = trns && trns.length >= 6 && trns[1] === line[s] && trns[3] === line[s + 1] && trns[5] === line[s + 2] ? 0 : 255;
      } else if (colorType === 0) {
        out[o] = out[o + 1] = out[o + 2] = line[s];
        out[o + 3] = trns && trns.length >= 2 && trns[1] === line[s] ? 0 : 255;
      } else if (colorType === 4) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; }
      else if (colorType === 3) {
        const idx = line[s];
        out[o] = palette ? palette[idx * 3] : 0; out[o + 1] = palette ? palette[idx * 3 + 1] : 0; out[o + 2] = palette ? palette[idx * 3 + 2] : 0;
        out[o + 3] = trns && idx < trns.length ? trns[idx] : 255;
      }
    }
    prev = line;
  }
  return { width, height, data: out };
}

/** 生のスキャンライン（フィルタ付き）を作って deflate する */
function compressRGBA(img, level) {
  const { width, height, data } = img;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (stride + 1);
    raw[o] = 1; // Sub フィルタ（単純で圧縮も悪くない）
    for (let i = 0; i < stride; i++) {
      const cur = data[y * stride + i];
      const left = i >= 4 ? data[y * stride + i - 4] : 0;
      raw[o + 1 + i] = (cur - left) & 0xff;
    }
  }
  return zlib.deflateSync(raw, { level: level == null ? 9 : level });
}

function ihdrChunk(width, height, colorType) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0); d.writeUInt32BE(height, 4);
  d[8] = 8; d[9] = colorType || 6; d[10] = 0; d[11] = 0; d[12] = 0;
  return chunk('IHDR', d);
}

/** { width, height, data: RGBA } → PNG Buffer */
function encode(img, level) {
  return Buffer.concat([SIG, ihdrChunk(img.width, img.height), chunk('IDAT', compressRGBA(img, level)), chunk('IEND', Buffer.alloc(0))]);
}

/** インデックス（1 画素 1 バイト）のスキャンラインを deflate（Up フィルタ） */
function compressIndexed(idx, width, height, level) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y++) {
    const o = y * (width + 1); raw[o] = y ? 2 : 0;
    for (let x = 0; x < width; x++) { const c = idx[y * width + x]; raw[o + 1 + x] = y ? (c - idx[(y - 1) * width + x]) & 0xff : c; }
  }
  return zlib.deflateSync(raw, { level: level == null ? 9 : level });
}

/**
 * 全フレーム共通の 256 色パレットを作る（RGBA のメディアンカット。透明は 0 番）。
 * LINE も「容量が大きい時は Pngyu 等で減色」と案内しており、アニメの容量（1MB）に収めるために使う
 */
function quantize(frames) {
  const hist = new Map();
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 8) continue;
      const k = ((d[i] >> 3) << 15) | ((d[i + 1] >> 3) << 10) | ((d[i + 2] >> 3) << 5) | (d[i + 3] >> 3);
      hist.set(k, (hist.get(k) || 0) + 1);
    }
  }
  const cols = [...hist.entries()].map(([k, n]) => ({ c: [(k >> 15) & 31, (k >> 10) & 31, (k >> 5) & 31, k & 31], n }));
  let boxes = [cols];
  const rangeOf = (b) => { let best = -1, ch = 0; for (let c = 0; c < 4; c++) { let lo = 99, hi = -1; for (const e of b) { if (e.c[c] < lo) lo = e.c[c]; if (e.c[c] > hi) hi = e.c[c]; } const r = (hi - lo) * (c === 3 ? 0.7 : c === 1 ? 1.2 : 1); if (r > best) { best = r; ch = c; } } return { best, ch }; };
  while (boxes.length < 255) {
    let bi = -1, score = 0;
    boxes.forEach((b, i) => { if (b.length < 2) return; const s = rangeOf(b).best * Math.sqrt(b.reduce((a, e) => a + e.n, 0)); if (s > score) { score = s; bi = i; } });
    if (bi < 0) break;
    const b = boxes[bi], { ch } = rangeOf(b);
    b.sort((p, q) => p.c[ch] - q.c[ch]);
    const tot = b.reduce((a, e) => a + e.n, 0); let acc = 0, cut = 1;
    for (let i = 0; i < b.length - 1; i++) { acc += b[i].n; if (acc >= tot / 2) { cut = i + 1; break; } }
    boxes.splice(bi, 1, b.slice(0, cut), b.slice(cut));
  }
  const pal = [[0, 0, 0, 0]].concat(boxes.map((b) => {
    const t = b.reduce((a, e) => a + e.n, 0);
    return [0, 1, 2, 3].map((c) => Math.round((b.reduce((a, e) => a + (e.c[c] * 8 + 4) * e.n, 0) / t)));
  }).map((c) => [Math.min(255, c[0]), Math.min(255, c[1]), Math.min(255, c[2]), c[3] >= 252 ? 255 : Math.min(255, c[3])]));
  const cache = new Map();
  const nearest = (r, g, b, a) => {
    const k = ((r >> 2) << 24 | (g >> 2) << 18 | (b >> 2) << 12 | (a >> 2) << 6) >>> 0;
    let v = cache.get(k); if (v !== undefined) return v;
    let bd = 1e18;
    for (let i = 1; i < pal.length; i++) { const p = pal[i]; const dd = (p[0] - r) ** 2 * 3 + (p[1] - g) ** 2 * 4 + (p[2] - b) ** 2 * 2 + (p[3] - a) ** 2 * 3; if (dd < bd) { bd = dd; v = i; } }
    cache.set(k, v); return v;
  };
  const indexed = frames.map((f) => {
    const out = new Uint8Array(f.width * f.height), d = f.data;
    for (let p = 0, i = 0; i < d.length; p++, i += 4) out[p] = d[i + 3] < 8 ? 0 : nearest(d[i], d[i + 1], d[i + 2], d[i + 3]);
    return out;
  });
  return { pal, indexed };
}

/**
 * APNG を組み立てる（全フレーム同サイズの RGBA 画像の配列）
 * frames: [{ width, height, data }], delays: 各フレームの表示ミリ秒, plays: ループ回数（0 = 無限）
 */
function encodeAPNG(frames, delaysMs, plays, level, opts) {
  if (!frames.length) throw new Error('フレームがありません');
  const { width, height } = frames[0];
  for (const f of frames) if (f.width !== width || f.height !== height) throw new Error('APNG の全フレームは同じサイズである必要があります');
  // opts.indexed: 256 色に減色して書く（容量が 1/3 前後になる）
  const q = opts && opts.indexed ? quantize(frames) : null;
  const parts = [SIG, ihdrChunk(width, height, q ? 3 : 6)];
  if (q) {
    parts.push(chunk('PLTE', Buffer.from(q.pal.flatMap((c) => c.slice(0, 3)))));
    parts.push(chunk('tRNS', Buffer.from(q.pal.map((c) => c[3]))));
  }
  const actl = Buffer.alloc(8); actl.writeUInt32BE(frames.length, 0); actl.writeUInt32BE(plays || 0, 4);
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((f, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(width, 4); fctl.writeUInt32BE(height, 8);
    fctl.writeUInt32BE(0, 12); fctl.writeUInt32BE(0, 16);
    const ms = Math.max(10, Math.round(delaysMs[i] != null ? delaysMs[i] : delaysMs[0]));
    fctl.writeUInt16BE(ms, 20); fctl.writeUInt16BE(1000, 22);
    fctl[24] = 1; // dispose_op: 1 = 背景（透明）に戻す
    fctl[25] = 0; // blend_op: 0 = 上書き
    parts.push(chunk('fcTL', fctl));
    const z = q ? compressIndexed(q.indexed[i], width, height, level) : compressRGBA(f, level);
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const s = Buffer.alloc(4); s.writeUInt32BE(seq++, 0);
      parts.push(chunk('fdAT', Buffer.concat([s, z])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** PNG / APNG の基本情報（サイズ・フレーム数）だけ読む */
function info(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const actl = chunks.find((c) => c.type === 'acTL');
  const fctls = chunks.filter((c) => c.type === 'fcTL');
  let totalMs = 0;
  for (const f of fctls) { const n = f.data.readUInt16BE(20), d = f.data.readUInt16BE(22) || 100; totalMs += (n / d) * 1000; }
  return {
    width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4),
    animated: !!actl, frames: actl ? actl.data.readUInt32BE(0) : 1, plays: actl ? actl.data.readUInt32BE(4) : 0, durationMs: Math.round(totalMs),
  };
}

/** 全フレームが全面・オフセット 0 の APNG（このツールが書いたもの）をフレームごとの RGBA に戻す */
function decodeAPNGFrames(buf) {
  const chunks = readChunks(buf);
  const ihdr = chunks.find((c) => c.type === 'IHDR');
  const frames = [];
  let cur = null;
  const extra = chunks.filter((c) => c.type === 'PLTE' || c.type === 'tRNS').map((c) => chunk(c.type, c.data));
  const flush = () => { if (cur && cur.length) frames.push(decode(Buffer.concat([SIG, chunk('IHDR', ihdr.data), ...extra, chunk('IDAT', Buffer.concat(cur)), chunk('IEND', Buffer.alloc(0))]))); };
  for (const c of chunks) {
    if (c.type === 'fcTL') { flush(); cur = []; }
    else if (c.type === 'IDAT' && cur) cur.push(c.data);
    else if (c.type === 'fdAT' && cur) cur.push(c.data.subarray(4));
  }
  flush();
  return frames;
}

/**
 * LINE のアニメ仕様: 1 回の再生は 1/2/3/4 秒ちょうど（端数不可）、再生秒数 × ループ数 ≤ 4 秒。
 * コマ数 n を 1 回 playSec 秒にきっちり割り振った遅延（ms の整数・合計がちょうど playSec×1000）とループ数を返す
 */
function lineTiming(n, playSec, maxSec) {
  playSec = playSec || 1; maxSec = maxSec || 4;
  const total = playSec * 1000, base = Math.floor(total / n), extra = total - base * n;
  const delays = Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
  return { delays, plays: Math.max(1, Math.min(4, Math.floor(maxSec / playSec))) };
}

module.exports = { decode, encode, encodeAPNG, decodeAPNGFrames, lineTiming, info, crc32 };
