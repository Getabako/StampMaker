// アニメスタンプのセリフを「1 文字ずつ」動かす（Node 標準のみ）
// キャラのコマは文字なしで描かせ、セリフは「文字だけの画像（text_NN.png）」として別に描かせる。
// 文字画像を 1 文字ずつに切り分け、コマごとに位置・大きさをずらして合成する（文字は同じ絵を使うので崩れない）。
'use strict';
const image = require('./image.js');

const ALPHA_ON = 128;
/** 文字だけの画像（透過済み）から文字の範囲 */
function textBox(img) {
  const b = image.bbox(img, ALPHA_ON);
  return b && { x0: b.x, y0: b.y, x1: b.x + b.w - 1, y1: b.y + b.h - 1 };
}

const isDark = (d, i) => d[i + 3] > ALPHA_ON && d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11 < 120;

/** 文字だけの画像を行 → 1 文字ずつの矩形に分ける */
/** 文字ごとの見込み幅（全角 = 1）。小さい「ゃ」「っ」や「！」は狭いので、行の文字数や切る位置の見込みに使う */
function charWeight(ch) {
  if (/[ぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮヵヶ]/.test(ch)) return 0.65;
  if (/[！!？?、。，．・：；]/.test(ch)) return 0.45;
  if (/[\x20-\x7e]/.test(ch)) return 0.6;
  return 1;
}

function splitGlyphs(textImg, box, count, chars) {
  const wts = chars && chars.length === count ? chars.map(charWeight) : new Array(count).fill(1);
  const { width: W, data } = textImg;
  const rowInk = [];
  for (let y = box.y0; y <= box.y1; y++) { let n = 0; for (let x = box.x0; x <= box.x1; x++) if (data[(y * W + x) * 4 + 3] > ALPHA_ON) n++; rowInk.push(n); }
  // 行: インクが 0 の行で区切る
  let lines = [];
  let start = -1;
  rowInk.forEach((n, i) => { if (n && start < 0) start = i; if (!n && start >= 0) { lines.push([start, i - 1]); start = -1; } });
  if (start >= 0) lines.push([start, rowInk.length - 1]);
  lines = lines.filter(([a, b]) => b - a >= 12).map(([a, b]) => [a + box.y0, b + box.y0]);
  if (!lines.length) return null;
  // 縦長すぎる 1 行（2 行が輪郭でくっついている）は真ん中付近のインク最小行で割る
  const colSpan = (y0, y1) => { let x0 = 1e9, x1 = -1; for (let y = y0; y <= y1; y++) for (let x = box.x0; x <= box.x1; x++) if (data[(y * W + x) * 4 + 3] > ALPHA_ON) { if (x < x0) x0 = x; if (x > x1) x1 = x; } return [x0, x1]; };
  if (lines.length === 1) {
    const [a, b] = lines[0]; const [x0, x1] = colSpan(a, b);
    const h = b - a + 1, w = x1 - x0 + 1;
    if (w / h < count * 0.55 && h > 60) {
      let best = -1, bestN = 1e9;
      for (let y = a + Math.floor(h * 0.3); y <= a + Math.floor(h * 0.7); y++) { const n = rowInk[y - box.y0]; if (n < bestN) { bestN = n; best = y; } }
      lines = [[a, best], [best + 1, b]];
    }
  }
  const spans = lines.map(([a, b]) => colSpan(a, b));
  // 文字の「中身」: 外側の白フチ（背景から白だけをたどって届く所）を除いた部分。
  // 白フチ同士がくっついていても中身は文字ごとに離れているので、列の切れ目は中身で探す
  const { height: H } = textImg;
  const N = W * H;
  const isWhite = (p) => data[p * 4] > 205 && data[p * 4 + 1] > 205 && data[p * 4 + 2] > 205;
  const outer = new Uint8Array(N); const oq = [];
  for (let p = 0; p < N; p++) if (data[p * 4 + 3] <= ALPHA_ON) { outer[p] = 1; oq.push(p); }
  for (let h = 0; h < oq.length; h++) {
    const q = oq[h]; const x = q % W;
    for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb >= 0 && nb < N && !outer[nb] && isWhite(nb)) { outer[nb] = 1; oq.push(nb); }
  }
  const segsOf = (y0, y1, x0, x1, on) => {
    const segs = []; let a = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      let ink = 0; if (x <= x1) for (let y = y0; y <= y1; y++) if (on(y * W + x)) { ink = 1; break; }
      if (ink && a < 0) a = x; if (!ink && a >= 0) { segs.push([a, x - 1]); a = -1; }
    }
    return segs;
  };
  // ふだんはインク（白フチ込み）の切れ目。白フチがくっついて切れ目が足りない時だけ中身の切れ目を使う
  const inkSegs = lines.map(([y0, y1], li) => segsOf(y0, y1, spans[li][0], spans[li][1], (p) => data[p * 4 + 3] > ALPHA_ON));
  const coreSegs = lines.map(([y0, y1], li) => segsOf(y0, y1, spans[li][0], spans[li][1], (p) => !outer[p]));
  const segsFor = (li, n) => (inkSegs[li].length >= n ? inkSegs[li] : coreSegs[li]);
  // 塊を並び順のまま n 文字にまとめる（「い」「ご」の点、「知」の矢と口など）。
  // まとめた幅が文字の見込み幅に近く、まとめた中の隙間が狭い分け方を選ぶ（動的計画法）。戻り値 { cost, segs }
  // 塊（列の切れ目で分けた範囲）と文字を、並び順のまま対応づける（動的計画法）。
  // 「いくつかの塊 → 1 文字」（「い」の 2 画、「知」の矢と口など）か「1 つの塊 → いくつかの文字」（白フチでくっついた「スク」など）。
  // 幅が文字の見込み幅に近く、1 文字にまとめた中の隙間が狭いものを選ぶ。戻り値 { cost, groups: [{ x0, x1, k, lw }] }
  const groupSegs = (segs0, lw, unit) => {
    // ごく細い塊（輪郭のにじみ・端の切れ端）は近い隣の塊に含める
    const segs = segs0.map((g) => g.slice());
    for (let k = 0; k < segs.length && segs.length > 1;) {
      if (segs[k][1] - segs[k][0] + 1 >= unit * 0.15) { k++; continue; }
      const gl = k > 0 ? segs[k][0] - segs[k - 1][1] : 1e9, gr = k < segs.length - 1 ? segs[k + 1][0] - segs[k][1] : 1e9;
      const j = gl <= gr ? k - 1 : k + 1;
      segs.splice(Math.min(k, j), 2, [Math.min(segs[k][0], segs[j][0]), Math.max(segs[k][1], segs[j][1])]);
      k = 0;
    }
    const n = lw.length, m = segs.length;
    const sumW = (g0, g1) => { let t = 0; for (let g = g0; g < g1; g++) t += lw[g]; return t; };
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(Infinity));
    const from = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(null));
    dp[0][0] = 0;
    for (let i = 0; i < m; i++) for (let g = 0; g < n; g++) {
      if (dp[i][g] === Infinity) continue;
      // いくつかの塊 → 1 文字
      let gap = 0;
      for (let i2 = i + 1; i2 <= m; i2++) {
        if (i2 > i + 1) gap = Math.max(gap, segs[i2 - 1][0] - segs[i2 - 2][1]);
        const w = segs[i2 - 1][1] - segs[i][0] + 1;
        const c = dp[i][g] + ((w - lw[g] * unit * 0.92) ** 2 + (gap * 2) ** 2) / (unit * unit);
        if (c < dp[i2][g + 1]) { dp[i2][g + 1] = c; from[i2][g + 1] = [i, g]; }
      }
      // 1 つの塊 → いくつかの文字（くっついているので切る。少しだけ割高にする）
      const w = segs[i][1] - segs[i][0] + 1;
      for (let g2 = g + 2; g2 <= n; g2++) {
        const c = dp[i][g] + ((w - sumW(g, g2) * unit * 0.92) ** 2) / (unit * unit) + 0.05 * (g2 - g - 1);
        if (c < dp[i + 1][g2]) { dp[i + 1][g2] = c; from[i + 1][g2] = [i, g]; }
      }
    }
    if (dp[m][n] === Infinity) return { cost: Infinity, groups: null };
    const groups = []; let i = m, g = n;
    while (i > 0) { const [pi, pg] = from[i][g]; groups.unshift({ x0: segs[pi][0], x1: segs[i - 1][1], k: g - pg, lw: lw.slice(pg, g) }); i = pi; g = pg; }
    return { cost: dp[m][n], groups };
  };
  // 行ごとの文字数: セリフを先頭から行に割り振る全通りのうち、各行の塊がいちばん自然に文字へまとまるもの
  // （塊が足りない行がある時は「1 文字分の幅」が行どうしでそろうものを選ぶ）
  let per = null;
  if (lines.length === 1) per = [count];
  else {
    let best = Infinity;
    const score = (p) => {
      let st = 0, c = 0; const units = [];
      p.forEach((n, i) => {
        const lw = wts.slice(st, st + n); st += n;
        const unit = (spans[i][1] - spans[i][0] + 1) / lw.reduce((x, y) => x + y, 0); units.push(unit);
        const g = groupSegs(segsFor(i, n), lw, unit); c += g.cost === Infinity ? 50 : g.cost;
      });
      const mean = units.reduce((x, y) => x + y, 0) / units.length;
      return c + 4 * units.reduce((x, u) => x + ((u - mean) / mean) ** 2, 0);
    };
    const tryPer = (k, start, acc) => {
      if (k === lines.length - 1) {
        const p = acc.concat([count - start]); if (p[p.length - 1] < 1) return;
        const v = score(p); if (v < best) { best = v; per = p; }
        return;
      }
      for (let n = 1; start + n <= count - (lines.length - 1 - k); n++) tryPer(k + 1, start + n, acc.concat([n]));
    };
    tryPer(0, 0, []);
  }
  const glyphs = [];
  let charAt = 0;
  lines.forEach(([y0, y1], li) => {
    const [x0, x1] = spans[li], n = per[li];
    const lw = wts.slice(charAt, charAt + n); charAt += n;
    const unit = (x1 - x0 + 1) / lw.reduce((a, b) => a + b, 0);
    const { groups } = groupSegs(segsFor(li, n), lw, unit);
    let cuts = [x0];
    const darkCut = (t, pitch) => {
      let best = t, bestN = 1e18;
      for (let x = Math.round(t - pitch * 0.3); x <= Math.round(t + pitch * 0.3); x++) {
        let d = 0; for (let y = y0; y <= y1; y++) if (isDark(data, (y * W + x) * 4)) d++;
        const score = d * 1000 + Math.abs(x - t);
        if (score < bestN) { bestN = score; best = x; }
      }
      return best;
    };
    if (groups) {
      groups.forEach((gr, gi) => {
        // くっついた塊を k 文字に切る: 見込み幅で割った位置の近くで、濃い色が最も少ない列
        const tot = gr.lw.reduce((a, b) => a + b, 0); let acc = 0;
        for (let j = 1; j < gr.k; j++) { acc += gr.lw[j - 1]; const t = Math.round(gr.x0 + ((gr.x1 - gr.x0 + 1) * acc) / tot); cuts.push(Math.max(darkCut(t, (gr.x1 - gr.x0 + 1) / gr.k), cuts[cuts.length - 1] + 1)); }
        if (gi < groups.length - 1) cuts.push(Math.round((gr.x1 + groups[gi + 1].x0) / 2) + 1);
      });
    } else {
      // 対応づけられない時: 行全体を見込み幅で割った位置の近くで切る
      let accW = 0;
      for (let i = 1; i < n; i++) { accW += lw[i - 1]; cuts.push(Math.max(darkCut(Math.round(x0 + accW * unit), unit), cuts[cuts.length - 1] + 1)); }
    }
    cuts.push(x1 + 1);
    for (let i = 0; i < n; i++) glyphs.push({ x: cuts[i], y: y0, w: cuts[i + 1] - cuts[i], h: y1 - y0 + 1, line: li });
  });
  return glyphs;
}

/**
 * 文字ごとの画像を切り出す。縦の直線で切ると、隣にはみ出した払いや白フチが隣の文字と一緒に動いて
 * 「白い切れ目」になるので、つながった塊（成分）ごとに持ち主の文字を決めて丸ごと渡す。
 * 2 文字が白フチでくっついた塊だけは、画素ごとに区切り線で分ける。
 * 戻り値: [{ img, offX, offY }]（img の (offX, offY) が文字の矩形の左上）
 */
function glyphImages(textImg, glyphs) {
  const { width: W, height: H, data } = textImg;
  const N = W * H;
  // 画素 → 文字番号（矩形の区切り。行は y の近さ、行内は x の区切りで決める）
  const lineIds = [...new Set(glyphs.map((g) => g.line))];
  const lineRange = lineIds.map((li) => { const gs = glyphs.filter((g) => g.line === li); return [Math.min(...gs.map((g) => g.y)), Math.max(...gs.map((g) => g.y + g.h))]; });
  const cellOf = (x, y) => {
    let k = 0, best = 1e9;
    lineRange.forEach(([a, b], i) => { const d = y < a ? a - y : y >= b ? y - b + 1 : 0; if (d < best) { best = d; k = i; } });
    let gi = -1, gd = 1e9;
    glyphs.forEach((g, i) => { if (g.line !== lineIds[k]) return; const d = x < g.x ? g.x - x : x >= g.x + g.w ? x - g.x - g.w + 1 : 0; if (d < gd) { gd = d; gi = i; } });
    return gi;
  };
  const labels = new Int32Array(N).fill(-1);
  const owner = new Int32Array(N).fill(-1);
  const small = [];
  const extra = glyphs.map(() => []); // 白フチを重ねて持つ分（owner とは別に、その文字にも描く画素）
  const stack = new Int32Array(N);
  for (let p = 0; p < N; p++) {
    if (labels[p] >= 0 || data[p * 4 + 3] <= 8) continue;
    const members = []; let sp = 0; stack[sp++] = p; labels[p] = p;
    while (sp) {
      const q = stack[--sp]; members.push(q);
      const x = q % W;
      for (const n of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (n >= 0 && n < N && labels[n] < 0 && data[n * 4 + 3] > 8) { labels[n] = p; stack[sp++] = n; }
    }
    const cells = members.map((q) => cellOf(q % W, Math.floor(q / W)));
    const cnt = new Map(); cells.forEach((c) => cnt.set(c, (cnt.get(c) || 0) + 1));
    const [top, n] = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    if (members.length < 600) { small.push({ members, top }); continue; }
    if (n / members.length >= 0.8) { members.forEach((q) => { owner[q] = top; }); continue; }
    splitJoined(members, cells);
  }
  // 細い切れ端（白フチの外側のにじみが本体から離れて残ったもの等）は、すぐ近くの文字に付ける。
  // 区切りの多数決で決めると隣の文字に付いて、動いた時に細い白線が残る
  for (const { members, top } of small) {
    const cnt = new Map();
    for (const q of members) {
      const x = q % W, y = (q - x) / W;
      for (let dy = -6; dy <= 6; dy += 2) for (let dx = -6; dx <= 6; dx += 2) {
        const X = x + dx, Y = y + dy; if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        const o = owner[Y * W + X]; if (o >= 0 && labels[Y * W + X] !== labels[q]) cnt.set(o, (cnt.get(o) || 0) + 1);
      }
    }
    const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
    members.forEach((q) => { owner[q] = best ? best[0] : top; });
  }
  // 白フチでつながった塊（斜体・極太の文字は隣と輪郭が重なる）: 縦線で切ると文字の本体まで割れて「白い切れ目」になる。
  // 白フチ以外の色のある部分（文字の本体）を塊に分けて持ち主を決め、白フチは近い本体に寄せる
  function splitJoined(members, cells) {
    const cellAt = new Map(); members.forEach((q, i) => cellAt.set(q, cells[i]));
    const blobCells = [...new Set(cells)].sort((a, b) => a - b);
    // 本体 = 白フチ以外の色のある部分。2 文字の濃い内フチ同士がくっついている時は、内フチも除いた「中の色」で分ける
    const notWhite = (q) => { const o = q * 4; return data[o + 3] > ALPHA_ON && !(data[o] > 205 && data[o + 1] > 205 && data[o + 2] > 205); };
    // 文字の中のツヤ（白い筋）で本体が割れないよう、外側から白フチを塗りつぶして「外側の白」以外を本体にする
    const outer = new Set(); const oq = [];
    for (const q of members) {
      if (notWhite(q)) continue; const x = q % W;
      for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb < 0 || nb >= N || data[nb * 4 + 3] <= ALPHA_ON) { outer.add(q); oq.push(q); break; }
    }
    for (let h = 0; h < oq.length; h++) {
      const q = oq[h]; const x = q % W;
      for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb >= 0 && nb < N && !outer.has(nb) && cellAt.has(nb) && !notWhite(nb)) { outer.add(nb); oq.push(nb); }
    }
    const inside = (q) => data[q * 4 + 3] > ALPHA_ON && !outer.has(q);
    const dark = (q) => { const o = q * 4; return data[o] * 0.3 + data[o + 1] * 0.59 + data[o + 2] * 0.11 < 95; };
    const fill = (q) => inside(q) && !dark(q);
    // さらに縁を 3 画素削った中身（内フチの中間色でつながってしまう時用）
    const fillCore = (q) => { if (!fill(q)) return false; const x = q % W; for (let k = 1; k <= 3; k++) for (const nb of [x - k >= 0 ? q - k : -1, x + k < W ? q + k : -1, q - W * k, q + W * k]) if (nb < 0 || nb >= N || !fill(nb)) return false; return true; };
    let core, comps, big;
    for (const isCore of [inside, fill, fillCore]) {
      core = new Map(); comps = [];
      for (const q0 of members) {
        if (core.has(q0) || !isCore(q0)) continue;
        const list = []; let sp = 0; stack[sp++] = q0; core.set(q0, comps.length);
        while (sp) {
          const q = stack[--sp]; list.push(q);
          const x = q % W;
          for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb >= 0 && nb < N && !core.has(nb) && cellAt.has(nb) && isCore(nb)) { core.set(nb, comps.length); stack[sp++] = nb; }
        }
        comps.push(list);
      }
      const maxLen = Math.max(0, ...comps.map((l) => l.length));
      big = comps.filter((l) => l.length >= Math.max(members.length * 0.004, maxLen * 0.05));
      if (big.length === blobCells.length) break;
    }
    // 本体の塊ごとに持ち主を決める。
    // 斜体だと文字が隣の区切りにはみ出すので、大きな塊の数と文字数が合えば「行 → 左から順」にそのまま割り当てる。
    // 合わない時は塊の多数決（2 文字の本体が直接くっついている塊だけ画素ごとの区切り）。小さな塊（ツヤの切れ端など）は白フチと同じく近い本体に寄せる
    const queue = [];
    if (big.length === blobCells.length) {
      const center = (l) => { let sx = 0, sy = 0; for (const q of l) { sx += q % W; sy += Math.floor(q / W); } return { x: sx / l.length, y: sy / l.length }; };
      const lineOfCell = (c) => glyphs[c].line;
      const withC = big.map((l) => ({ l, c: center(l) }));
      // 行ごとにまとめる: 各塊の中心 y がどの行の範囲に入るか
      const lineIdx = (y) => { let k = 0, best = 1e9; lineRange.forEach(([a, b], i) => { const d = y < a ? a - y : y >= b ? y - b + 1 : 0; if (d < best) { best = d; k = i; } }); return lineIds[k]; };
      withC.sort((a, b) => (lineIdx(a.c.y) - lineIdx(b.c.y)) || (a.c.x - b.c.x));
      // 並び順で当てた文字の区切りと、塊の位置が大きくずれていないこと（ずれていたら多数決に任せる）
      const okLines = withC.every((w, i) => { const g = glyphs[blobCells[i]]; return lineIdx(w.c.y) === lineOfCell(blobCells[i]) && w.c.x >= g.x - g.w * 0.6 && w.c.x <= g.x + g.w * 1.6; });
      if (okLines) {
        withC.forEach((w, i) => { for (const q of w.l) { owner[q] = blobCells[i]; queue.push(q); } });
      }
    }
    if (!queue.length) {
      const ws = glyphs.map((g) => g.w).sort((a, b) => a - b); const medianW = ws[Math.floor(ws.length / 2)];
      for (const list of comps) {
        const c2 = new Map(); for (const q of list) { const c = cellAt.get(q); c2.set(c, (c2.get(c) || 0) + 1); }
        const [t, m] = [...c2.entries()].sort((a, b) => b[1] - a[1])[0];
        // 斜体の 1 文字が隣の区切りにはみ出しているだけなら丸ごと。区切りで割るのは、塊が 2 文字分ほど幅広い（本当に 2 文字くっついている）時だけ
        let x0 = W, x1 = 0; for (const q of list) { const x = q % W; if (x < x0) x0 = x; if (x > x1) x1 = x; }
        const whole = m / list.length >= 0.85 || (x1 - x0 + 1) < medianW * 1.4;
        for (const q of list) { owner[q] = whole ? t : cellAt.get(q); queue.push(q); }
      }
    }
    // 白フチ: 本体から外へ広げて、いちばん近い本体の持ち主にする
    const dist = new Map(); for (const q of queue) dist.set(q, 0);
    let R = 0;
    for (let h = 0; h < queue.length; h++) {
      const q = queue[h]; const x = q % W;
      for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb >= 0 && nb < N && owner[nb] < 0 && cellAt.has(nb)) { owner[nb] = owner[q]; const d = dist.get(q) + 1; dist.set(nb, d); if (d > R) R = d; queue.push(nb); }
    }
    for (const q of members) if (owner[q] < 0) owner[q] = cellAt.get(q);
    // 境目で白フチを半分ずつ分けると、離れた時に片側のフチが欠けたり隣に細い白線が残る。
    // 各文字が自分の本体からフチの太さ分の白を「重ねて」持つ（文字ごとに完全なフチが付く）
    // フチの太さ: 白画素の「本体からの距離」の 75% 点（文字の間で白がつながった太い所に引っ張られないように）
    const ds = []; for (const [q, d] of dist) if (d > 0) ds.push(d);
    ds.sort((a, b) => a - b);
    R = Math.min(60, Math.ceil((ds.length ? ds[Math.floor(ds.length * 0.75)] : 0) * 1.25) + 1);
    // 自分の本体から R より遠い白は、白の持ち主から外す（隣の文字のフチが細い線になって付いてくるのを防ぐ）
    const coreOf = new Map(); for (const q of members) if (core.has(q) && owner[q] >= 0) { const g = owner[q]; if (!coreOf.has(g)) coreOf.set(g, []); coreOf.get(g).push(q); }
    for (const [g, seeds] of coreOf) {
      const seen = new Map(); for (const q of seeds) seen.set(q, 0);
      const qu = seeds.slice();
      for (let h = 0; h < qu.length; h++) {
        const q = qu[h]; const d = seen.get(q); if (d >= R) continue; const x = q % W;
        for (const nb of [x > 0 ? q - 1 : -1, x < W - 1 ? q + 1 : -1, q - W, q + W]) if (nb >= 0 && nb < N && !seen.has(nb) && cellAt.has(nb) && !core.has(nb) && (owner[nb] === g || outer.has(nb))) { seen.set(nb, d + 1); qu.push(nb); if (owner[nb] !== g) extra[g].push(nb); }
      }
      // 持ち主になっている白のうち、自分の本体から R 以内に無いものは外す（どの本体からも遠い白は残す）
      for (const q of members) if (owner[q] === g && !core.has(q) && !seen.has(q) && dist.get(q) <= R) owner[q] = -2;
    }
  }
  return glyphs.map((g, gi) => {
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    const mine = new Uint8Array(N);
    for (let p = 0; p < N; p++) if (owner[p] === gi) mine[p] = 1;
    for (const p of extra[gi]) mine[p] = 1;
    for (let p = 0; p < N; p++) if (mine[p]) { const x = p % W, y = (p - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) { x0 = g.x; y0 = g.y; x1 = g.x; y1 = g.y; }
    const img = image.blank(x1 - x0 + 1, y1 - y0 + 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const p = y * W + x; if (!mine[p]) continue;
      const o = ((y - y0) * img.width + (x - x0)) * 4;
      data.copy(img.data, o, p * 4, p * 4 + 4);
      // 外周の半透明・ピンクがかった明るい色は白フチのにじみ（背景のマゼンタ混じり）なので白に戻す
      const r = data[p * 4], gg = data[p * 4 + 1], b = data[p * 4 + 2];
      if (data[p * 4 + 3] < 250 || (r > 170 && b > 150 && r - gg > 25 && b - gg > 15)) img.data.fill(255, o, o + 3);
    }
    return { img, offX: g.x - x0, offY: g.y - y0 };
  });
}

/** textMotion の言葉から文字の動きの型を決める */
function styleOf(textMotion) {
  const t = textMotion || '';
  if (/回転|くるっ|くるくる|回る/.test(t)) return 'spin';
  if (/ポンポン|飛び出|出てくる|ぽんぽん/.test(t)) return 'popin';
  if (/びよ|伸び|ゴム|ぐにゃ/.test(t)) return 'rubber';
  if (/震|ぶるぶる|ガタガタ/.test(t)) return 'shake';
  if (/拡大|大き|ぐっと|ドン|ポン/.test(t)) return 'pop';
  if (/揺|浮|ふわ|波|傾/.test(t)) return 'wave';
  return 'hop';
}

/** charMotion（キャラ全体の動き）の言葉から型を決める。空なら motion（しぐさ）から推定 */
function charStyleOf(charMotion, motionText) {
  const t = charMotion || '';
  if (/なし|動かさない/.test(t)) return 'none';
  if (/ぴょんぴょん|弾む|バウンド/.test(t)) return 'bounce';
  if (/ジャンプ|跳|飛び上/.test(t)) return 'jump';
  if (/ズーム|飛び出|迫|近づ|ぐっと/.test(t)) return 'zoom';
  if (/揺|傾|左右|スイング/.test(t)) return 'swing';
  if (/震|ぶるぶる|ガタガタ/.test(t)) return 'shake';
  const m = motionText || '';
  if (/跳|ジャンプ/.test(m)) return 'jump';
  if (/震|ぶるぶる/.test(m)) return 'shake';
  if (/振る|揺/.test(m)) return 'swing';
  return 'bounce';
}

const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * Math.max(0, Math.min(1, x))); // 0→1 なめらか
const rnd = (a, b) => { const r = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453; return (r - Math.floor(r)) * 2 - 1; };

/**
 * 文字 i（n 文字中）の tick t（L 中）での変形 { dx, dy, sx, sy, rot, center }。h は文字の高さ。t=0 は必ず静止。
 * center=true は文字の中心を軸に、false は足元を軸に変形する
 */
function motion(style, i, n, t, L, h) {
  const u = t / L;
  const d = 0.42, stagger = n > 1 ? (1 - d - 0.08) / (n - 1) : 0;
  const local = Math.max(0, Math.min(1, (u - i * stagger) / d));
  const bump = Math.sin(Math.PI * local); // 0 → 1 → 0
  const R = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, center: false };
  if (!t) return R;
  if (style === 'pop') { const s = 1 + 0.75 * bump; return Object.assign(R, { sx: s, sy: s, rot: 0.14 * bump * (i % 2 ? 1 : -1), center: true }); }
  if (style === 'wave') { const ph = 2 * Math.PI * (u - i / Math.max(n, 1) * 0.6); const w = Math.sin(ph) - Math.sin(-2 * Math.PI * i / Math.max(n, 1) * 0.6); return Object.assign(R, { dy: -h * 0.3 * w, rot: 0.2 * Math.cos(ph) * Math.sin(Math.PI * u), center: true }); }
  if (style === 'shake') return Object.assign(R, { dx: h * 0.07 * rnd(i + 1, t), dy: h * 0.13 * rnd(i + 7, t + 3), rot: 0.14 * rnd(i + 3, t + 9), center: true }); // 横揺れが大きいと隣の文字と重なるので控えめ
  if (style === 'spin') { const sp = ease(local); return Object.assign(R, { dy: -h * 0.25 * bump, sx: 1 + 0.25 * bump, sy: 1 + 0.25 * bump, rot: 2 * Math.PI * sp, center: true }); }
  if (style === 'rubber') { const w = Math.sin(2.5 * Math.PI * local) * (1 - local * 0.7); return Object.assign(R, { sx: 1 - 0.4 * w, sy: 1 + 0.8 * w }); }
  if (style === 'popin') {
    // 1 文字ずつ順に「シュッと縮んでポンと大きく出て戻る」（同時に消えるのは 1〜2 文字だけ）
    const k = local;
    const s = k < 0.3 ? 1 - ease(k / 0.3) * 0.9 : k < 0.65 ? 0.1 + ease((k - 0.3) / 0.35) * 1.4 : 1.5 - ease((k - 0.65) / 0.35) * 0.5;
    return Object.assign(R, { sx: s, sy: s, rot: (k < 0.65 ? 1 : 0) * Math.sin(Math.PI * k / 0.65) * 0.5, center: true });
  }
  // hop: 1 文字ずつ大きく跳ねる。踏み切りと着地でつぶれ、空中で縦に伸びる
  const sq = local < 0.12 ? Math.sin(Math.PI * local / 0.12) : local > 0.88 ? Math.sin(Math.PI * (local - 0.88) / 0.12) : 0;
  return Object.assign(R, { dy: -h * 0.75 * Math.sin(Math.PI * Math.max(0, Math.min(1, (local - 0.1) / 0.8))), sx: 1 + 0.25 * sq - 0.08 * bump, sy: 1 - 0.28 * sq + 0.15 * bump });
}

/** キャラ全体の tick t（L 中）での変形 { dx, dy, sx, sy, rot }。H はキャラの高さ。t=0 は静止 */
function charMotion(style, t, L, H) {
  const u = t / L;
  const R = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0 };
  if (!t || style === 'none') return R;
  if (style === 'jump') {
    // ため（つぶれる）→ 大ジャンプ（伸びる）→ 着地（つぶれる）→ 戻る
    if (u < 0.18) { const k = Math.sin(Math.PI * u / 0.18 * 0.5); return Object.assign(R, { sx: 1 + 0.12 * k, sy: 1 - 0.16 * k }); }
    if (u < 0.72) { const k = (u - 0.18) / 0.54; return Object.assign(R, { dy: -H * 0.2 * Math.sin(Math.PI * k), sx: 1 - 0.07 * Math.sin(Math.PI * k), sy: 1 + 0.1 * Math.sin(Math.PI * k) }); }
    const k = Math.sin(Math.PI * (u - 0.72) / 0.28); return Object.assign(R, { sx: 1 + 0.12 * k, sy: 1 - 0.15 * k });
  }
  if (style === 'bounce') {
    const k = (u * 2) % 1, up = Math.sin(Math.PI * k);
    const sq = k < 0.15 ? Math.sin(Math.PI * k / 0.15) : k > 0.85 ? Math.sin(Math.PI * (k - 0.85) / 0.15) : 0;
    return Object.assign(R, { dy: -H * 0.1 * up, sx: 1 + 0.08 * sq, sy: 1 - 0.1 * sq + 0.04 * up });
  }
  if (style === 'zoom') { const k = Math.sin(Math.PI * u); const back = u > 0.5 ? Math.sin(Math.PI * (u - 0.5) * 2) * 0.04 : 0; return Object.assign(R, { sx: 1 + 0.18 * k - back, sy: 1 + 0.18 * k - back, rot: 0.06 * Math.sin(2 * Math.PI * u) }); }
  if (style === 'swing') { const k = Math.sin(2 * Math.PI * u); return Object.assign(R, { rot: 0.16 * k, dx: H * 0.05 * k, dy: -H * 0.03 * Math.abs(k) }); }
  if (style === 'shake') return Object.assign(R, { dx: H * 0.035 * rnd(1, t), dy: H * 0.02 * rnd(2, t), rot: 0.05 * rnd(3, t) });
  return R;
}
/** 動きに必要な余白（キャラを枠の何割に縮めて置くか） */
const CHAR_FIT = { jump: 0.84, bounce: 0.9, zoom: 0.84, swing: 0.86, shake: 0.93, none: 1 };

/**
 * キャラのコマ（文字なし・透過済み）と文字だけの画像から、1 文字ずつ動くスタンプのコマを作る。
 * box: { w, h, margin }。戻り値: { frames（box サイズ）, style } または null（文字を分けられない時）
 */
function compose(charFrames, textImg, phrase, placement, textMotion, box, opts) {
  opts = opts || {};
  const cstyle = charStyleOf(opts.charMotion, opts.motion);
  const count = [...String(phrase || '').replace(/\s/g, '')].length;
  if (!count || !charFrames.length) return null;
  const tb = textBox(textImg);
  if (!tb) return null;
  const glyphs = splitGlyphs(textImg, tb, count, [...String(phrase || '').replace(/\s/g, '')]);
  if (!glyphs || glyphs.length !== count) return null;
  // 行ごとに詰め直す（文字画像の行間は広すぎることが多い）: 行の間は行の高さの 1 割、各行は中央ぞろえ
  const lineIds = [...new Set(glyphs.map((g) => g.line))];
  const L0 = lineIds.map((li) => {
    const gs = glyphs.filter((g) => g.line === li);
    return { x0: Math.min(...gs.map((g) => g.x)), x1: Math.max(...gs.map((g) => g.x + g.w)), y0: Math.min(...gs.map((g) => g.y)), y1: Math.max(...gs.map((g) => g.y + g.h)) };
  });
  const lines = L0.length;
  const rawW = Math.max(...L0.map((l) => l.x1 - l.x0));
  const gapRaw = Math.max(...L0.map((l) => l.y1 - l.y0)) * 0.1;
  const rawH = L0.reduce((sum, l) => sum + (l.y1 - l.y0), 0) + gapRaw * (lines - 1);
  const style = styleOf(textMotion);
  const innerW = box.w - box.margin * 2, innerH = box.h - box.margin * 2;
  const ts = Math.min((innerW * 0.96) / rawW, (innerH * (lines > 1 ? 0.4 : 0.24)) / rawH);
  const lineH = Math.max(...glyphs.map((g) => g.h)) * ts;
  const room = lineH * ({ hop: 0.6, pop: 0.3, wave: 0.4, shake: 0.2, spin: 0.3, rubber: 0.35, popin: 0.25 }[style] || 0.5);
  const textH = rawH * ts;
  const bottom = /下/.test(placement || '');
  const textTop = bottom ? box.h - box.margin - textH - lineH * 0.12 : box.margin + room;
  // 各文字の置き場所（静止時の左上）
  let yAcc = textTop;
  const lineTop = L0.map((l) => { const y = yAcc; yAcc += (l.y1 - l.y0 + gapRaw) * ts; return y; });
  const place = glyphs.map((g) => {
    const k = lineIds.indexOf(g.line), l = L0[k];
    return { x: (box.w - (l.x1 - l.x0) * ts) / 2 + (g.x - l.x0) * ts, y: lineTop[k] + (g.y - l.y0) * ts };
  });
  // キャラはテキストの帯を除いた残りに収める（コマ全体の共通枠で）
  const charTop = bottom ? box.margin : Math.round(textTop + textH * 0.85);
  const charH = bottom ? Math.round(textTop + textH * 0.15 - box.margin) : box.h - box.margin - charTop;
  // キャラはジャンプ・ズーム等で動く分だけ小さめに置き、足元（下端の中央）を軸に変形する
  const cf = CHAR_FIT[cstyle] || 1;
  const fitted = image.fitFramesInBox(charFrames, Math.round(box.w * cf / 2) * 2, Math.round(charH * cf / 2) * 2, 0);
  const cw = fitted[0].width, ch = fitted[0].height;
  const footX = box.w / 2, footY = charTop + charH;
  const glyphImgs = glyphImages(textImg, glyphs);
  const baseScaled = glyphImgs.map((gi) => image.resize(gi.img, gi.img.width * ts, gi.img.height * ts));
  const L = opts.ticks ? Math.min(opts.maxTicks || 20, opts.ticks) : Math.min(opts.maxTicks || 20, charFrames.length * (opts.ticksPerFrame || 2));
  const out = [];
  for (let t = 0; t < L; t++) {
    const canvas = image.blank(box.w, box.h);
    const cm = charMotion(cstyle, t, L, ch);
    const cimg = fitted[Math.min(fitted.length - 1, Math.floor((t * fitted.length) / L))];
    if (cstyle === 'none' || !t) image.composite(canvas, cimg, Math.round(footX - cw / 2), Math.round(footY - ch));
    else image.drawTransformed(canvas, cimg, footX + cm.dx, footY + cm.dy, cm.sx, cm.sy, cm.rot, cw / 2, ch);
    // 動いている（大きい・高い）文字ほど後に描いて上に重ねる。隣の白フチが動いている文字の上に乗って切れ目に見えるのを防ぐ
    const ms = glyphs.map((g, i) => {
      const gh = g.h * ts;
      const m = motion(style, i, count, t, L, gh);
      // 2 行目以降は上の行にぶつからないよう、跳ねる高さを抑えて代わりに少し大きくする
      if (lineIds.indexOf(g.line) > 0 && m.dy < -gh * 0.12) { const e = (-m.dy / gh - 0.12) * 0.5; m.sx += e; m.sy += e; m.dy = -gh * 0.12; }
      return { i, m, w: Math.abs(m.sx - 1) + Math.abs(m.sy - 1) + Math.abs(m.dy) / gh + Math.abs(m.dx) / gh + Math.abs(m.rot) };
    }).sort((a, b) => a.w - b.w);
    for (const { i, m } of ms) {
      const g = glyphs[i], G = glyphImgs[i];
      if (m.sx < 0.03 || m.sy < 0.03) continue;
      const still = Math.abs(m.sx - 1) < 0.01 && Math.abs(m.sy - 1) < 0.01 && Math.abs(m.rot) < 0.005;
      if (still) { image.composite(canvas, baseScaled[i], Math.round(place[i].x + m.dx - G.offX * ts), Math.round(place[i].y + m.dy - G.offY * ts)); continue; }
      // 軸: 文字の中心 または 足元（文字画像内の座標）
      const ax = G.offX + g.w / 2, ay = G.offY + (m.center ? g.h / 2 : g.h);
      const px = place[i].x + (g.w * ts) / 2 + m.dx, py = place[i].y + (m.center ? g.h * ts / 2 : g.h * ts) + m.dy;
      image.drawTransformed(canvas, G.img, px, py, ts * m.sx, ts * m.sy, m.rot, ax, ay);
    }
    out.push(canvas);
  }
  return { frames: out, style, charStyle: cstyle, glyphs: glyphs.length };
}

module.exports = { compose, splitGlyphs, glyphImages, textBox, styleOf, charStyleOf, charMotion, CHAR_FIT };
