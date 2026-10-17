// 画像加工（Node 標準のみ）: 背景色キーで透過、透明部分のトリム、縮小、枠内への配置
'use strict';
const fs = require('node:fs');
const png = require('./png.js');

const KEY_COLOR = [255, 0, 255]; // #FF00FF マゼンタ。白はキャラに残したいので背景にはマゼンタを使わせる

function load(p) { return png.decode(fs.readFileSync(p)); }
function save(p, img) { fs.writeFileSync(p, png.encode(img)); }

function blank(width, height) { return { width, height, data: Buffer.alloc(width * height * 4) }; }

/**
 * キー色だけを透明にする（AnimeMaker の chroma.ts と同じ考え方）。
 * 距離 < hard: 完全透明 / hard〜soft: 輪郭の半透明（キー色の混入を差し引く）
 */
function chromaKey(img, key, opts) {
  key = key || KEY_COLOR;
  const hard = (opts && opts.hard) || 70, soft = (opts && opts.soft) || 130;
  const { width, height, data } = img;
  const out = Buffer.from(data);
  const [kr, kg, kb] = key;
  for (let i = 0; i < width * height * 4; i += 4) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    const d = Math.sqrt((r - kr) ** 2 + (g - kg) ** 2 + (b - kb) ** 2);
    if (d < hard) out[i + 3] = 0;
    else if (d < soft) {
      const t = (d - hard) / (soft - hard);
      out[i + 3] = Math.round(Math.min(255, out[i + 3] * t));
      // デスピル: キー色の成分を薄める
      out[i] = Math.round(r - (kr - r) * (1 - t) * 0.3);
      out[i + 1] = Math.round(g + (g - kg) * (1 - t) * 0.1);
      out[i + 2] = Math.round(b - (kb - b) * (1 - t) * 0.3);
      for (let k = 0; k < 3; k++) out[i + k] = Math.max(0, Math.min(255, out[i + k]));
    }
  }
  return { width, height, data: out };
}

/** 画像の背景がキー色か（四隅の多数決） */
function hasKeyBackground(img, key) {
  key = key || KEY_COLOR;
  const { width, height, data } = img;
  const pts = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1], [Math.floor(width / 2), 0], [0, Math.floor(height / 2)]];
  let hit = 0;
  for (const [x, y] of pts) {
    const i = (y * width + x) * 4;
    const d = Math.sqrt((data[i] - key[0]) ** 2 + (data[i + 1] - key[1]) ** 2 + (data[i + 2] - key[2]) ** 2);
    if (d < 90 && data[i + 3] > 0) hit++;
  }
  return hit >= 4;
}

/** 既に透過済みか（四隅がほぼ透明） */
function hasTransparentBackground(img) {
  const { width, height, data } = img;
  const pts = [[0, 0], [width - 1, 0], [0, height - 1], [width - 1, height - 1]];
  let hit = 0;
  for (const [x, y] of pts) if (data[(y * width + x) * 4 + 3] < 16) hit++;
  return hit >= 3;
}

/** 不透明部分の矩形 { x, y, w, h }（α > threshold） */
function bbox(img, threshold) {
  threshold = threshold == null ? 8 : threshold;
  const { width, height, data } = img;
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (data[(y * width + x) * 4 + 3] > threshold) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(img, x, y, w, h) {
  const out = blank(w, h);
  for (let yy = 0; yy < h; yy++) {
    const src = ((y + yy) * img.width + x) * 4;
    img.data.copy(out.data, yy * w * 4, src, src + w * 4);
  }
  return out;
}

/** 面積平均（ボックスフィルタ）で縮小。拡大はバイリニア。α はプリマルチプライで扱う */
function resize(img, dw, dh) {
  dw = Math.max(1, Math.round(dw)); dh = Math.max(1, Math.round(dh));
  const { width: sw, height: sh, data } = img;
  if (sw === dw && sh === dh) return { width: sw, height: sh, data: Buffer.from(data) };
  const out = blank(dw, dh);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const y0 = y * sy, y1 = Math.min(sh, (y + 1) * sy);
    for (let x = 0; x < dw; x++) {
      const x0 = x * sx, x1 = Math.min(sw, (x + 1) * sx);
      let r = 0, g = 0, b = 0, a = 0, wsum = 0;
      const iy0 = Math.floor(y0), iy1 = Math.max(iy0 + 1, Math.ceil(y1));
      const ix0 = Math.floor(x0), ix1 = Math.max(ix0 + 1, Math.ceil(x1));
      for (let yy = iy0; yy < iy1 && yy < sh; yy++) {
        const wy = Math.min(yy + 1, y1) - Math.max(yy, y0);
        if (wy <= 0) continue;
        for (let xx = ix0; xx < ix1 && xx < sw; xx++) {
          const wx = Math.min(xx + 1, x1) - Math.max(xx, x0);
          if (wx <= 0) continue;
          const w = wx * wy, i = (yy * sw + xx) * 4, al = data[i + 3] / 255;
          r += data[i] * al * w; g += data[i + 1] * al * w; b += data[i + 2] * al * w; a += al * w; wsum += w;
        }
      }
      const o = (y * dw + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a); out.data[o + 1] = Math.round(g / a); out.data[o + 2] = Math.round(b / a);
        out.data[o + 3] = Math.round((a / wsum) * 255);
      }
    }
  }
  return out;
}

/** src を dst の (x, y) に合成（通常のアルファ合成） */
function composite(dst, src, x, y) {
  for (let yy = 0; yy < src.height; yy++) {
    const dy = y + yy; if (dy < 0 || dy >= dst.height) continue;
    for (let xx = 0; xx < src.width; xx++) {
      const dx = x + xx; if (dx < 0 || dx >= dst.width) continue;
      const si = (yy * src.width + xx) * 4, di = (dy * dst.width + dx) * 4;
      const sa = src.data[si + 3] / 255; if (sa === 0) continue;
      const da = dst.data[di + 3] / 255, oa = sa + da * (1 - sa);
      for (let k = 0; k < 3; k++) dst.data[di + k] = Math.round((src.data[si + k] * sa + dst.data[di + k] * da * (1 - sa)) / (oa || 1));
      dst.data[di + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}

/**
 * 透過画像を「枠 (boxW x boxH) に余白 margin を残して収める」。
 * trimFirst: 透明部分を先に切り落とす（スタンプは中身を枠いっぱいに使いたい）
 * 戻り値は boxW x boxH の RGBA（偶数サイズ前提）
 */
function fitInBox(img, boxW, boxH, margin, opts) {
  opts = opts || {};
  let src = img;
  if (opts.trim !== false) {
    const b = bbox(img);
    if (b) src = crop(img, b.x, b.y, b.w, b.h);
  }
  const innerW = boxW - margin * 2, innerH = boxH - margin * 2;
  const scale = Math.min(innerW / src.width, innerH / src.height, opts.allowUpscale ? Infinity : 1);
  const dw = Math.max(1, Math.round(src.width * scale)), dh = Math.max(1, Math.round(src.height * scale));
  const scaled = resize(src, dw, dh);
  const out = blank(boxW, boxH);
  const ox = Math.round((boxW - dw) / 2);
  const oy = opts.align === 'bottom' ? boxH - margin - dh : Math.round((boxH - dh) / 2);
  return composite(out, scaled, ox, oy);
}

/**
 * アニメ用: 複数フレームを「共通のバウンディングボックス」で切り出して同じ枠に収める。
 * フレームごとにトリムすると位置がズレて踊るので、全フレームの和集合で切る。
 */
function fitFramesInBox(frames, boxW, boxH, margin) {
  let ub = null;
  for (const f of frames) {
    const b = bbox(f); if (!b) continue;
    if (!ub) ub = Object.assign({}, b);
    else {
      const x1 = Math.max(ub.x + ub.w, b.x + b.w), y1 = Math.max(ub.y + ub.h, b.y + b.h);
      ub.x = Math.min(ub.x, b.x); ub.y = Math.min(ub.y, b.y); ub.w = x1 - ub.x; ub.h = y1 - ub.y;
    }
  }
  if (!ub) ub = { x: 0, y: 0, w: frames[0].width, h: frames[0].height };
  const innerW = boxW - margin * 2, innerH = boxH - margin * 2;
  const scale = Math.min(innerW / ub.w, innerH / ub.h, 1);
  const dw = Math.max(1, Math.round(ub.w * scale)), dh = Math.max(1, Math.round(ub.h * scale));
  const ox = Math.round((boxW - dw) / 2), oy = Math.round((boxH - dh) / 2);
  return frames.map((f) => {
    const c = crop(f, ub.x, ub.y, ub.w, ub.h);
    return composite(blank(boxW, boxH), resize(c, dw, dh), ox, oy);
  });
}

/** 生成直後の画像を読み、必要なら透過して返す（マゼンタ背景 → 透明。既に透過済みならそのまま） */
function loadAsTransparent(p) {
  const img = load(p);
  if (hasTransparentBackground(img)) return img;
  if (hasKeyBackground(img)) return chromaKey(img);
  // 白背景などで来てしまった場合: 四隅の色をキーにして抜く（白がキャラ内にあると欠けるが、何も出ないよりまし）
  const i = 0;
  const key = [img.data[i], img.data[i + 1], img.data[i + 2]];
  const out = chromaKey(img, key, { hard: 24, soft: 60 });
  // 四隅にキャラや小物がかかって判定を外しただけで、背景はマゼンタのことが多い。マゼンタがまとまって残っていれば抜く
  // （キャラにマゼンタは使わせない決まりなので、抜いても欠けない）
  return keyShare(out) > 0.03 ? chromaKey(out) : out;
}

/** キー色に近い不透明ピクセルの割合 */
function keyShare(img) {
  const { width, height, data } = img;
  let n = 0;
  for (let i = 0; i < width * height * 4; i += 4) {
    if (data[i + 3] > 0 && Math.abs(data[i] - KEY_COLOR[0]) + Math.abs(data[i + 1] - KEY_COLOR[1]) + Math.abs(data[i + 2] - KEY_COLOR[2]) < 90) n++;
  }
  return n / (width * height);
}

/** 不透明ピクセルの割合（0〜1）。空画像の検出に使う */
function coverage(img) {
  let n = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 8) n++;
  return n / (img.width * img.height);
}

/**
 * src を拡大縮小・回転して dst に描く（バイリニア・プリマルチプライ）。
 * アンカー (ax, ay)（src 内の座標）が dst の (x, y) に来る。sx / sy は横・縦の倍率（つぶし・伸ばし用）、rot はラジアン
 */
function drawTransformed(dst, src, x, y, sx, sy, rot, ax, ay) {
  const cos = Math.cos(rot || 0), sin = Math.sin(rot || 0);
  const corners = [[0, 0], [src.width, 0], [0, src.height], [src.width, src.height]].map(([u, v]) => {
    const px = (u - ax) * sx, py = (v - ay) * sy;
    return [x + px * cos - py * sin, y + px * sin + py * cos];
  });
  const X0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[0])))), X1 = Math.min(dst.width - 1, Math.ceil(Math.max(...corners.map((c) => c[0]))));
  const Y0 = Math.max(0, Math.floor(Math.min(...corners.map((c) => c[1])))), Y1 = Math.min(dst.height - 1, Math.ceil(Math.max(...corners.map((c) => c[1]))));
  const W = src.width, H = src.height, d = src.data;
  // 縮小が強いときはあらかじめ縮めてからサンプリング（ギザギザ防止）
  if (Math.max(Math.abs(sx), Math.abs(sy)) < 0.75 && Math.min(W, H) > 2) {
    const k = Math.max(Math.abs(sx), Math.abs(sy));
    const small = resize(src, src.width * k, src.height * k);
    return drawTransformed(dst, small, x, y, sx / (small.width / W), sy / (small.height / H), rot, ax * (small.width / W), ay * (small.height / H));
  }
  for (let Y = Y0; Y <= Y1; Y++) for (let X = X0; X <= X1; X++) {
    const qx = X + 0.5 - x, qy = Y + 0.5 - y;
    const u = (qx * cos + qy * sin) / sx + ax - 0.5, v = (-qx * sin + qy * cos) / sy + ay - 0.5;
    if (u < -1 || v < -1 || u > W || v > H) continue;
    const u0 = Math.floor(u), v0 = Math.floor(v), fu = u - u0, fv = v - v0;
    let r = 0, g = 0, b = 0, a = 0;
    for (const [uu, vv, w] of [[u0, v0, (1 - fu) * (1 - fv)], [u0 + 1, v0, fu * (1 - fv)], [u0, v0 + 1, (1 - fu) * fv], [u0 + 1, v0 + 1, fu * fv]]) {
      if (uu < 0 || vv < 0 || uu >= W || vv >= H || w <= 0) continue;
      const i = (vv * W + uu) * 4, al = (d[i + 3] / 255) * w;
      r += d[i] * al; g += d[i + 1] * al; b += d[i + 2] * al; a += al;
    }
    if (a <= 0.002) continue;
    const di = (Y * dst.width + X) * 4, da = dst.data[di + 3] / 255, oa = a + da * (1 - a);
    dst.data[di] = Math.round((r + dst.data[di] * da * (1 - a)) / oa);
    dst.data[di + 1] = Math.round((g + dst.data[di + 1] * da * (1 - a)) / oa);
    dst.data[di + 2] = Math.round((b + dst.data[di + 2] * da * (1 - a)) / oa);
    dst.data[di + 3] = Math.round(oa * 255);
  }
  return dst;
}

module.exports = { drawTransformed, KEY_COLOR, load, save, blank, chromaKey, hasKeyBackground, hasTransparentBackground, bbox, crop, resize, composite, fitInBox, fitFramesInBox, loadAsTransparent, coverage };
