// 制作パイプライン: 企画（codex → plan JSON）→ 画像（codex image_gen → 透過・枠合わせ）→ 点検 → アニメのコマ → APNG → 書き出し ZIP
// 生成 AI は codex CLI（サブスク）のみ。有料 API は一切使わない。
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const store = require('./store.js');
const prompts = require('./prompts.js');
const image = require('./image.js');
const png = require('./png.js');
const textanim = require('./textanim.js');
const autofill = require('./autofill.js');
const zip = require('./zip.js');
const { spec, TEXT_LIMITS, MAX_FILE_BYTES, lineLength } = require('./specs.js');
const { which, runCodex, cleanCodexOutput } = require('./codex.js');

// フリー版: 静止画 8 個まで
function freeAllowed(kind, count) { return kind === 'static' && count <= 8; }

// --- ジョブ管理（メモリ内。画面は /api/jobs でポーリング） ---
const jobs = [];
let seq = 0;
function newJob(kind, label, projectId) {
  const j = { id: ++seq, kind, label, projectId, stage: 'queued', stageLabel: '待機中', progress: 0, detail: '', error: '', createdAt: Date.now(), updatedAt: Date.now() };
  jobs.unshift(j);
  while (jobs.length > 60) jobs.pop();
  return j;
}
function setStage(j, stage, label, progress, detail) {
  j.stage = stage; j.stageLabel = label;
  if (progress != null) j.progress = progress;
  if (detail !== undefined) j.detail = detail;
  j.updatedAt = Date.now();
}
function listJobs() { return jobs; }

// セット単位で直列（同じセットの作業が重ならないように）。別セットは同時に走ってよいが codex の負荷を考え全体でも 1 本に絞る
let chain = Promise.resolve();
function enqueue(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
function waitIdle() { return chain; }

function z2(n) { return String(n).padStart(2, '0'); }
function setStatus(cfg, project, status, label, error) {
  project.status = status; project.statusLabel = label; project.error = error || '';
  store.saveProject(cfg.dataDir, project);
}
/** codex の出力から致命的な失敗（レート制限・未ログイン）を読み取る。該当すれば日本語のメッセージ、無ければ '' */
function codexFatal(cx) {
  const t = (cx.out || '') + '\n' + (cx.err || '');
  if (/429 Too Many Requests|exceeded retry limit/.test(t)) return 'codex（ChatGPT サブスク）の利用上限に達しているか、混雑しています（429）。しばらく待ってから「未完成の分を描く」でやり直してください。';
  if (/not logged in|codex login|401 Unauthorized/i.test(t)) return 'codex にログインしていません。ターミナルで codex login を実行してください。';
  return '';
}

async function ensureCodex() {
  if (!(await which('codex'))) throw new Error('codex CLI が見つかりません。brew install codex（または npm i -g @openai/codex）のあと codex login してください。');
}
// stickers を渡すと、その中の who に出てくるキャラの参照画像だけ（大人数セットで取り違えを防ぐ）
function refPaths(project, stickers) {
  const ids = stickers ? prompts.idsOfStickers(project, stickers) : project.characters.map((c) => c.id);
  return project.characters.filter((c) => ids.includes(c.id)).map((c) => path.join(project.dir, c.ref));
}
function planOf(project, no) { return project.plan.stickers.find((p) => p.no === no) || {}; }

/** codex に JSON を書かせて読み戻す（通信切れ対策で 1 回だけやり直す） */
async function codexJSON(cfg, prompt, outPath, cwd, job, images) {
  await ensureCodex();
  try { fs.rmSync(outPath, { force: true }); } catch {}
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  let cx, gen;
  for (let attempt = 1; attempt <= 2; attempt++) {
    cx = await runCodex(prompt, { cwd, model: cfg.codexModel || undefined, images: images || [], onLine: (l) => { if (job && l.trim()) job.detail = l.trim().slice(0, 140); } });
    gen = store.readJSON(outPath, null);
    if (gen && typeof gen === 'object') return gen;
    const fatal = codexFatal(cx);
    if (fatal) throw new Error(fatal);
    if (attempt === 1 && job) job.detail = '通信が切れたため、もう一度やり直しています';
  }
  const noise = cleanCodexOutput(cx.err).slice(-400) || cleanCodexOutput(cx.out).slice(-400);
  throw new Error(`codex から JSON を取得できませんでした（codex login・バージョン 0.150 以上・通信状態を確認してください）。code=${cx.code} ${noise}`);
}

// ---- 1. 企画 ----
// who: 1 人の id / 「id+id」（2 人）/ "both"（2 人セットのみ）。不正なら 1 人目
function normalizeWho(ids, who) {
  const w = String(who || '').trim();
  if (ids.includes(w)) return w;
  if (w === 'both') return ids.length === 2 ? 'both' : ids[0];
  const list = Array.from(new Set(w.split('+').map((x) => x.trim()).filter((x) => ids.includes(x)))).slice(0, 2);
  if (list.length === 2 && ids.length === 2) return 'both';
  return list.length ? list.join('+') : ids[0];
}
function normalizePlan(project, raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const list = Array.isArray(p.stickers) ? p.stickers : [];
  const ids = project.characters.map((c) => c.id);
  const stickers = [];
  for (let i = 0; i < project.count; i++) {
    const s = list[i] || {};
    const phrase = project.kind === 'emoji' ? '' : String(s.phrase || '').trim().slice(0, 12);
    stickers.push({
      no: i + 1,
      who: normalizeWho(ids, s.who),
      phrase,
      expression: String(s.expression || '笑顔').trim(),
      pose: String(s.pose || '上半身、正面').trim(),
      framing: String(s.framing || '').trim(),
      angle: String(s.angle || '').trim(),
      props: String(s.props || '').trim(),
      textPlacement: phrase ? String(s.textPlacement || '上').trim() : 'なし',
      motion: String(s.motion || '').trim(),
      textMotion: String(s.textMotion || '').trim(),
      charMotion: String(s.charMotion || '').trim(),
      textStyle: String(s.textStyle || '').trim(),
    });
  }
  const inRange = (n) => Number.isInteger(n) && n >= 1 && n <= project.count;
  let title = String(p.title || project.title).trim();
  while (lineLength(title) > TEXT_LIMITS.title) title = title.slice(0, -1);
  let description = String(p.description || '').trim();
  if (lineLength(description) > TEXT_LIMITS.description) {
    // 文の途中で切れないよう、収まる範囲の最後の「。」までにする（無ければ字数で切る）
    while (lineLength(description) > TEXT_LIMITS.description) description = description.slice(0, -1);
    const end = description.lastIndexOf('。');
    if (end > description.length * 0.4) description = description.slice(0, end + 1);
  }
  const clipEn = (v, n) => { let t = String(v || '').replace(/\s+/g, ' ').trim(); if (t.length > n) { t = t.slice(0, n); const e = Math.max(t.lastIndexOf('. '), t.lastIndexOf('.')); if (e > n * 0.4) t = t.slice(0, e + 1); } return t; };
  return {
    title, description,
    titleEn: clipEn(p.titleEn, 40), descriptionEn: clipEn(p.descriptionEn, 160),
    concept: String(p.concept || '').trim(),
    style: String(p.style || '').trim(),
    mainNo: inRange(p.mainNo) ? p.mainNo : 1,
    tabNo: inRange(p.tabNo) ? p.tabNo : (inRange(p.mainNo) ? p.mainNo : 1),
    stickers,
  };
}

function initStickers(project) {
  project.stickers = project.plan.stickers.map((s) => {
    const old = (project.stickers || []).find((x) => x.no === s.no);
    // 完成済み、またはアニメの決めポーズまで描けているもの（コマ待ち）は残す。中断後の再開で描き直さないため
    if (old && (old.status === 'done' || (old.status === 'drawn' && fs.existsSync(rawPath(project, s.no))))) return old;
    return { no: s.no, status: 'pending', file: '', raw: '', frames: [], issue: '', history: [] };
  });
}

async function runPlan(cfg, project, job) {
  const outPath = path.join(project.dir, 'work', 'plan.json');
  setStage(job, 'plan', '売れやすい構成でセリフと表情を企画中（codex）', 10, `${project.kindLabel} ${project.count} 個`);
  const raw = await codexJSON(cfg, prompts.planPrompt(project, outPath), outPath, project.dir, job, refPaths(project));
  project.plan = normalizePlan(project, raw);
  // 構図・向き・小物が単調なら、指摘を付けて 1 回だけ codex に手直しさせる
  const issues = prompts.varietyIssues(project, project.plan);
  if (issues.length) {
    setStage(job, 'plan', '構図・向き・小物のバラエティを整えています（codex）', 15, issues[0].slice(0, 70));
    try {
      const fixed = normalizePlan(project, await codexJSON(cfg, prompts.replanPrompt(project, (issues.some((x) => /登場/.test(x)) ? '番号は変えずに、登場キャラ（who）の振り分けと、振り替えたスタンプのセリフ・表情・ポーズ・小物を直し、' : 'セリフと番号は変えずに、表情・ポーズ・構図・向き・小物だけを直して、') + '次の問題をすべて解消する:\n- ' + issues.join('\n- '), outPath), outPath, project.dir, job, refPaths(project)));
      if (prompts.varietyIssues(project, fixed).length <= issues.length) project.plan = fixed;
    } catch (e) { if (/429|ログイン/.test(e.message)) throw e; }
  }
  project.title = project.plan.title || project.title;
  initStickers(project);
  store.saveProject(cfg.dataDir, project);
}

// ---- 2. 画像 ----
function rawName(no) { return `raw_${z2(no)}.png`; }
function rawPath(project, no) { return path.join(project.dir, 'work', rawName(no)); }
function textName(no) { return `text_${z2(no)}.png`; }
function textPath(project, no) { return path.join(project.dir, 'work', textName(no)); }
/** アニメでセリフがある → 文字は別画像（text_NN.png）で描かせて 1 文字ずつ動かす */
function needsTextImage(project, no) {
  if (!spec(project.kind).animated) return false;
  const p = project.plan.stickers.find((x) => x.no === no);
  return !!(p && p.phrase);
}
function stickerPath(project, no) { return path.join(project.dir, 'stickers', `${z2(no)}.png`); }

/** 生成直後の正方形画像 → 透過 → 枠に収めて stickers/NN.png に保存。成功なら true */
function finalizeStatic(project, no) {
  const s = spec(project.kind);
  const src = rawPath(project, no);
  if (!fs.existsSync(src)) return false;
  let img;
  try { img = image.loadAsTransparent(src); } catch { return false; }
  if (image.coverage(img) < 0.01) return false;
  const fitted = image.fitInBox(img, s.sticker.w, s.sticker.h, s.sticker.margin);
  const out = stickerPath(project, no);
  image.save(out, fitted);
  if (fs.statSync(out).size > MAX_FILE_BYTES) image.save(out, fitted); // 通常 1MB を超えないが念のため
  return true;
}

function pending(project) {
  return project.stickers.filter((st) => st.status !== 'done' && st.status !== 'drawn');
}

/** まとめて描く（バッチ）。並列数 cfg.parallelN */
async function generateBatches(cfg, project, job, targets, label) {
  await ensureCodex();
  const rawDir = path.join(project.dir, 'work');
  const batches = [];
  // 大人数セットは同じキャラの組み合わせごとにまとめて描く（渡す参照画像を絞るため）
  const groups = new Map();
  for (const t of targets) {
    const key = project.characters.length > 2 ? prompts.whoIds(project, planOf(project, t.no).who).sort().join('+') : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const g of groups.values()) for (let i = 0; i < g.length; i += cfg.batchSizeN) batches.push(g.slice(i, i + cfg.batchSizeN));
  let doneCount = project.stickers.filter((st) => st.status === 'done').length;
  const total = project.count;
  const report = () => { job.detail = `${doneCount}/${total} 個 完了`; };
  let idx = 0;
  const worker = async () => {
    while (idx < batches.length) {
      const batch = batches[idx++];
      const plans = batch.map((st) => Object.assign({}, project.plan.stickers.find((p) => p.no === st.no), { instruction: st.instruction }));
      const prompt = plans.length === 1 && plans[0].instruction
        ? prompts.regenPrompt(project, plans[0], rawDir, plans[0].instruction)
        : prompts.imagesPrompt(project, plans, rawDir);
      for (const st of batch) for (const f of [rawPath(project, st.no), textPath(project, st.no)]) try { fs.rmSync(f, { force: true }); } catch {}
      const cx = await runCodex(prompt, { cwd: project.dir, model: cfg.codexModel || undefined, images: refPaths(project, plans), timeout: 40 * 60 * 1000 });
      const fatal = codexFatal(cx);
      for (const st of batch) {
        const textOk = !needsTextImage(project, st.no) || fs.existsSync(textPath(project, st.no));
        const ok = finalizeStatic(project, st.no) && textOk;
        const target = project.stickers.find((x) => x.no === st.no);
        if (ok) { target.status = 'drawn'; target.raw = `work/${rawName(st.no)}`; target.file = `stickers/${z2(st.no)}.png`; target.issue = ''; }
        else { target.status = 'error'; target.issue = fatal || (textOk ? '画像が生成されなかった' : '文字画像が生成されなかった'); }
        if (ok && !spec(project.kind).animated) { target.status = 'done'; doneCount++; }
      }
      store.saveProject(cfg.dataDir, project);
      report();
    }
  };
  setStage(job, 'images', label || 'スタンプを描いています（codex image_gen）', 30, `${targets.length} 個を生成します（1 個 1〜2 分）`);
  await Promise.all(Array.from({ length: Math.min(cfg.parallelN, batches.length) }, worker));
  const fatalAll = targets.length && targets.every((t) => { const st = project.stickers.find((x) => x.no === t.no); return st.status === 'error' && /429|ログイン/.test(st.issue || ''); });
  if (fatalAll) throw new Error(project.stickers.find((x) => x.no === targets[0].no).issue);
}

// ---- 3. 点検 ----
async function checkImages(cfg, project, job, targets) {
  if (!cfg.checkImagesOn || !targets.length) return [];
  setStage(job, 'check', '文字崩れ・キャラ崩れを点検中（codex）', 60, `${targets.length} 個`);
  const outPath = path.join(project.dir, 'work', 'check.json');
  const bad = [];
  for (let i = 0; i < targets.length; i += 8) {
    const chunk = targets.slice(i, i + 8);
    const list = [];
    for (const st of chunk) {
      const p = project.plan.stickers.find((x) => x.no === st.no);
      const apart = needsTextImage(project, st.no);
      list.push(Object.assign({}, p, { rawName: rawName(st.no) }, apart ? { phrase: '' } : {}));
      if (apart) list.push(Object.assign({}, p, { rawName: textName(st.no), textOnly: true }));
    }
    const imgs = refPaths(project, chunk.map((st) => planOf(project, st.no))).concat(chunk.flatMap((st) => [rawPath(project, st.no), textPath(project, st.no)]).filter((p) => fs.existsSync(p)));
    let r;
    try { r = await codexJSON(cfg, prompts.checkPrompt(project, list, outPath), outPath, project.dir, job, imgs); } catch { continue; }
    for (const res of (r && r.results) || []) {
      const m = /(?:raw|text)_(\d+)\.png/.exec(String(res.file || ''));
      if (!m) continue;
      const no = parseInt(m[1], 10);
      const target = project.stickers.find((x) => x.no === no);
      if (!target) continue;
      if (res.textOk === false || res.charOk === false || res.bgOk === false) {
        const issue = (/text_/.test(String(res.file)) ? '文字画像: ' : '') + String(res.issue || '点検で不備');
        target.issue = (bad.some((b) => b.no === no) ? target.issue + ' / ' : '') + issue.slice(0, 200);
        const prev = bad.find((b) => b.no === no);
        if (prev) { prev.instruction = target.issue; continue; }
        bad.push({ no, instruction: target.issue });
      }
    }
  }
  store.saveProject(cfg.dataDir, project);
  return bad;
}

// ---- 4. アニメ ----
function framePath(project, no, i) { return path.join(project.dir, 'work', `frame_${z2(no)}_${z2(i)}.png`); }

async function animateOne(cfg, project, job, st, frameCount) {
  const s = spec(project.kind);
  const plan = project.plan.stickers.find((p) => p.no === st.no);
  const raw = rawPath(project, st.no);
  if (!fs.existsSync(raw)) throw new Error(`${z2(st.no)} の決めポーズがありません`);
  for (let i = 2; i <= frameCount; i++) try { fs.rmSync(framePath(project, st.no, i), { force: true }); } catch {}
  fs.copyFileSync(raw, framePath(project, st.no, 1));
  for (let attempt = 1; attempt <= 2; attempt++) {
    const missing = [];
    for (let i = 2; i <= frameCount; i++) if (!fs.existsSync(framePath(project, st.no, i))) missing.push(i);
    if (!missing.length) break;
    const cx = await runCodex(prompts.framesPrompt(project, plan, `work/${rawName(st.no)}`, frameCount, path.join(project.dir, 'work')), {
      cwd: project.dir, model: cfg.codexModel || undefined, images: refPaths(project, [plan]).concat([raw]), timeout: 40 * 60 * 1000,
    });
    const fatal = codexFatal(cx); if (fatal) throw new Error(fatal);
  }
  assembleAnimation(cfg, project, st, frameCount);
}

/** 描けているコマ（work/frame_NN_*.png）と文字画像から APNG を組む。codex は使わない */
function assembleAnimation(cfg, project, st, frameCount) {
  const s = spec(project.kind);
  const plan = project.plan.stickers.find((p) => p.no === st.no);
  const frames = [];
  for (let i = 1; i <= frameCount; i++) {
    const p = framePath(project, st.no, i);
    if (!fs.existsSync(p)) continue;
    try { const im = image.loadAsTransparent(p); if (image.coverage(im) >= 0.01) frames.push(im); } catch {}
  }
  if (frames.length < s.frames.min) throw new Error(`${z2(st.no)} のコマが ${frames.length} 枚しか作れませんでした（最低 ${s.frames.min} 枚）`);
  const out = stickerPath(project, st.no);
  // セリフは文字画像から 1 文字ずつ動かして合成（キャラ 1 コマを 2 拍に分け、文字だけ細かく動かす）。
  // 1MB を超えたら拍を減らす。文字画像が使えない時はキャラのコマだけで組む
  // 再生時間: LINE は 1 回の再生が 1 秒ちょうど等の整数秒でないと受け付けない（0.72 秒などはエラー）。
  // 1 回 1 秒に割り振り、ループ 4 回（合計 4 秒）にする
  let fitted = null;
  const tp = textPath(project, st.no);
  // 256 色に減色して書く（LINE も減色ツールを案内。容量が 1/4 前後になり、コマを細かく割れる）
  const write = (fr) => { const t = png.lineTiming(fr.length, 1, s.maxDurationMs / 1000); fs.writeFileSync(out, png.encodeAPNG(fr, t.delays, t.plays, 9, { indexed: true })); return t; };
  let timing = null;
  if (needsTextImage(project, st.no) && fs.existsSync(tp)) {
    const textImg = image.loadAsTransparent(tp);
    const box = { w: s.sticker.w, h: s.sticker.h, margin: s.sticker.margin };
    // 1 秒を最大 20 コマに割ってなめらかに（キャラのコマは同じ絵を何拍か保つ）。1MB を超えたらコマを減らす
    for (const ticks of [s.frames.max, 16, 12, 8]) {
      const r = textanim.compose(frames, textImg, plan.phrase, plan.textPlacement, plan.textMotion, box, { ticks, maxTicks: s.frames.max, charMotion: plan.charMotion, motion: plan.motion });
      if (!r) break;
      timing = write(r.frames); fitted = r.frames;
      if (fs.statSync(out).size <= MAX_FILE_BYTES) break;
    }
  }
  if (!fitted) {
    fitted = image.fitFramesInBox(frames, s.sticker.w, s.sticker.h, s.sticker.margin);
    timing = write(fitted);
  }
  const target = project.stickers.find((x) => x.no === st.no);
  target.frames = fitted.length; target.loops = timing.plays; target.durationMs = 1000 * timing.plays;
  target.file = `stickers/${z2(st.no)}.png`;
  target.status = 'done';
  store.saveProject(cfg.dataDir, project);
}

async function animateAll(cfg, project, job, targets) {
  const frameCount = Math.max(5, Math.min(8, parseInt((project.brief || {}).frames, 10) || 6));
  let done = 0;
  setStage(job, 'animate', 'アニメのコマを描いて APNG に組んでいます（codex）', 70, `${targets.length} 個（1 個 3〜5 分）`);
  let idx = 0;
  const worker = async () => {
    while (idx < targets.length) {
      const st = targets[idx++];
      try { await animateOne(cfg, project, job, st, frameCount); }
      catch (e) { const t = project.stickers.find((x) => x.no === st.no); t.status = 'error'; t.issue = e.message; store.saveProject(cfg.dataDir, project); }
      done++; job.detail = `${done}/${targets.length} 個 完了`;
    }
  };
  await Promise.all(Array.from({ length: Math.min(cfg.parallelN, targets.length) }, worker));
}

/** 描けているコマから組み直して ZIP まで更新する（文字の動きの調整など。描き直しはしない） */
function recompose(cfg, project) {
  for (const st of project.stickers || []) {
    const n = fs.readdirSync(path.join(project.dir, 'work')).filter((f) => f.startsWith(`frame_${z2(st.no)}_`)).length;
    if (n) assembleAnimation(cfg, project, st, n);
  }
  exportSet(cfg, project);
}

// ---- 5. 書き出し ----
function exportSet(cfg, project) {
  const s = spec(project.kind);
  const exportDir = path.join(project.dir, 'export');
  fs.mkdirSync(exportDir, { recursive: true });
  const files = [];
  const problems = [];
  const doneList = project.stickers.filter((st) => st.status === 'done' && fs.existsSync(path.join(project.dir, st.file)));
  if (!doneList.length) throw new Error('完成したスタンプがありません');
  const firstDone = (no) => doneList.find((st) => st.no === no) || doneList[0];
  // main / tab は決めポーズの静止画（アニメは 1 コマ目 = raw）から作る
  const mainSrc = rawPath(project, firstDone(project.plan.mainNo).no);
  const tabSrc = rawPath(project, firstDone(project.plan.tabNo).no);
  if (s.main && s.animated) {
    // アニメのメイン画像も APNG（静止画だとアップロードでエラー）。メインに選んだスタンプのコマを 240 枠に縮める
    const src = firstDone(project.plan.mainNo);
    const fr = png.decodeAPNGFrames(fs.readFileSync(path.join(project.dir, src.file)));
    const fitted = image.fitFramesInBox(fr, s.main.w, s.main.h, 4);
    const t = png.lineTiming(fitted.length, 1, s.maxDurationMs / 1000);
    const p = path.join(exportDir, 'main.png'); fs.writeFileSync(p, png.encodeAPNG(fitted, t.delays, t.plays, 9, { indexed: true })); files.push({ name: 'main.png', path: p });
  } else if (s.main) {
    const im = image.fitInBox(image.loadAsTransparent(mainSrc), s.main.w, s.main.h, 8);
    const p = path.join(exportDir, 'main.png'); image.save(p, im); files.push({ name: 'main.png', path: p });
  }
  {
    const im = image.fitInBox(image.loadAsTransparent(tabSrc), s.tab.w, s.tab.h, 2);
    const p = path.join(exportDir, 'tab.png'); image.save(p, im); files.push({ name: 'tab.png', path: p });
  }
  for (const st of doneList) {
    const p = path.join(project.dir, st.file);
    const buf = fs.readFileSync(p);
    const inf = png.info(buf);
    if (buf.length > MAX_FILE_BYTES) problems.push(`${z2(st.no)}: 1MB を超えています`);
    if (inf.width > s.sticker.w || inf.height > s.sticker.h) problems.push(`${z2(st.no)}: サイズ超過 ${inf.width}x${inf.height}`);
    if (inf.width % 2 || inf.height % 2) problems.push(`${z2(st.no)}: 奇数サイズ`);
    if (s.animated) {
      if (!inf.animated || inf.frames < s.frames.min || inf.frames > s.frames.max) problems.push(`${z2(st.no)}: コマ数 ${inf.frames}`);
      if (inf.durationMs * (inf.plays || 1) > s.maxDurationMs) problems.push(`${z2(st.no)}: 再生時間超過`);
      if (inf.durationMs % 1000) problems.push(`${z2(st.no)}: 1 回の再生が ${inf.durationMs}ms（LINE は 1〜4 秒ちょうどのみ）`);
    }
    files.push({ name: s.zipName(st.no), path: p });
  }
  if (doneList.length !== project.count) problems.push(`完成 ${doneList.length} 個 / 予定 ${project.count} 個（個数は ${s.counts.join('/')} のどれかに揃える必要があります）`);
  const zipPath = path.join(exportDir, `${project.id}.zip`);
  zip.writeZip(zipPath, files);
  const total = files.reduce((a, f) => a + fs.statSync(f.path).size, 0);
  project.outputs = { zip: `export/${path.basename(zipPath)}`, main: s.main ? 'export/main.png' : '', tab: 'export/tab.png', files: files.length, totalBytes: total, problems };
  // 申請メモ
  const memo = [
    `# ${project.plan.title}`, '',
    `種類: ${s.label} / 個数: ${doneList.length}`, '',
    `## 説明文（${TEXT_LIMITS.description} 文字以内）`, project.plan.description, '',
    '## 英語（LINE STORE の英語表示。必須）', `Title: ${project.plan.titleEn || '（未作成）'}`, `Description: ${project.plan.descriptionEn || '（未作成）'}`, '',
    '## 一括入力', 'export/line-autofill.html を開き、緑のボタンをブックマークバーへドラッグ → LINE Creators Market の「新規登録」ページで押すと、タイプ・タイトル・説明文（英語・日本語）・コピーライト・AIの使用がまとめて入ります。', '',
    `## クリエイター名`, cfg.creatorName || '（設定タブで登録）', '',
    `## コピーライト`, cfg.copyright || '（設定タブで登録。英数字のみ）', '',
    '## 生成 AI の申告', 'このセットは画像生成 AI を使って制作しています。LINE Creators Market の申請画面で「生成 AI を使用」にチェックしてください（販売画面に AI アイコンが付きます）。', '',
    '## セリフ一覧', ...project.plan.stickers.map((p) => `${z2(p.no)}. ${p.phrase || '（文字なし）'} — ${p.expression} / ${p.pose}`),
    '', problems.length ? '## 要確認\n' + problems.map((x) => '- ' + x).join('\n') : '## 仕様チェック: 問題なし',
  ].join('\n');
  fs.writeFileSync(path.join(exportDir, 'README.md'), memo);
  fs.writeFileSync(path.join(exportDir, 'line-autofill.html'), autofill.buildPage(cfg, project));
  store.saveProject(cfg.dataDir, project);
}

// ---- まとめて実行 ----
async function runGenerate(cfg, project, job) {
  const s = spec(project.kind);
  initStickers(project);
  let targets = pending(project).map((st) => ({ no: st.no }));
  if (targets.length) await generateBatches(cfg, project, job, targets);
  // 生成されなかったものを 1 回やり直し
  let retry = project.stickers.filter((st) => st.status === 'error').map((st) => ({ no: st.no }));
  if (retry.length) await generateBatches(cfg, project, job, retry, '作れなかった分をやり直しています');
  // 点検 → 不備は指示付きで 1 回だけ描き直し
  const drawn = project.stickers.filter((st) => st.status === 'drawn' || st.status === 'done').filter((st) => targets.some((t) => t.no === st.no));
  const bad = await checkImages(cfg, project, job, drawn);
  if (bad.length) {
    for (const b of bad) { const t = project.stickers.find((x) => x.no === b.no); t.status = s.animated ? 'pending' : 'pending'; }
    await generateBatches(cfg, project, job, bad.map((b) => ({ no: b.no, instruction: b.instruction })), '点検で見つかった不備を直しています');
  }
  if (s.animated) {
    const anim = project.stickers.filter((st) => st.status === 'drawn');
    if (anim.length) await animateAll(cfg, project, job, anim);
  }
  setStage(job, 'export', 'LINE の仕様に合わせて検査し ZIP に書き出し中', 95, '');
  exportSet(cfg, project);
}

function submit(cfg, lic, kind, count, characterIds, brief, opts) {
  opts = opts || {};
  if (lic.mode === 'free' && !freeAllowed(kind, count)) throw new Error('フリー版で作れるのは静止画 8 個までです。画面上部のメール認証欄でアシュラ会員の認証をすると全種類・最大 40 個まで作れます。');
  const chars = characterIds.map((id) => store.getCharacter(cfg.dataDir, id)).filter(Boolean);
  if (!chars.length) throw new Error('キャラクターが見つかりません');
  if (chars.length > 20) throw new Error('キャラクターは 20 人までです');
  const project = store.createProject(cfg.dataDir, kind, count, chars, brief);
  const job = newJob('create', `${project.kindLabel}: ${project.title}`, project.id);
  enqueue(async () => {
    try {
      setStatus(cfg, project, 'running', '企画中');
      await runPlan(cfg, project, job);
      if (opts.auto === false) { setStatus(cfg, project, 'planned', '企画できました（確認して「描き始める」）'); setStage(job, 'done', '企画完了', 100, ''); return; }
      setStatus(cfg, project, 'running', '制作中');
      await runGenerate(cfg, project, job);
      setStatus(cfg, project, 'done', '完成');
      setStage(job, 'done', '完了', 100, '');
    } catch (e) {
      setStatus(cfg, project, 'error', '失敗', e.message);
      job.error = e.message; setStage(job, 'error', '失敗', job.progress, '');
    }
  });
  return { project, job };
}

function generate(cfg, lic, project) {
  if (lic.mode === 'free' && !freeAllowed(project.kind, project.count)) throw new Error('フリー版では静止画 8 個までです');
  const job = newJob('generate', `制作: ${project.title}`, project.id);
  enqueue(async () => {
    try {
      // 企画の段階で失敗していた（429 等）ときは企画から作り直す
      if (!project.plan) { setStatus(cfg, project, 'running', '企画中'); await runPlan(cfg, project, job); }
      setStatus(cfg, project, 'running', '制作中');
      await runGenerate(cfg, project, job);
      setStatus(cfg, project, 'done', '完成');
      setStage(job, 'done', '完了', 100, '');
    } catch (e) {
      setStatus(cfg, project, 'error', '失敗', e.message);
      job.error = e.message; setStage(job, 'error', '失敗', job.progress, '');
    }
  });
  return job;
}

/** 企画を画面で直して保存（セリフ・表情・ポーズ・タイトル等） */
function savePlan(cfg, project, patch) {
  if (!project.plan) throw new Error('まだ企画がありません');
  const p = Object.assign({}, project.plan, patch || {});
  project.plan = normalizePlan(project, Object.assign({}, p, { stickers: Array.isArray(patch.stickers) ? patch.stickers : project.plan.stickers }));
  project.title = project.plan.title || project.title;
  // セリフ等が変わったスタンプは未完成に戻す
  for (const st of project.stickers || []) {
    const before = (p.stickers || []).find((x) => x.no === st.no);
    const after = project.plan.stickers.find((x) => x.no === st.no);
    if (before && after && JSON.stringify([before.phrase, before.expression, before.pose, before.framing, before.angle, before.props, before.who, before.motion]) !== JSON.stringify([after.phrase, after.expression, after.pose, after.framing, after.angle, after.props, after.who, after.motion])) st.status = 'pending';
  }
  store.saveProject(cfg.dataDir, project);
  return project;
}

function replan(cfg, project, instruction) {
  if (!project.plan) throw new Error('まだ企画がありません');
  const job = newJob('replan', `企画の手直し: ${project.title}`, project.id);
  enqueue(async () => {
    try {
      setStatus(cfg, project, 'running', '企画を手直し中');
      setStage(job, 'plan', '指示に沿って企画を手直し中（codex）', 20, instruction.slice(0, 120));
      const outPath = path.join(project.dir, 'work', 'plan.json');
      const before = project.plan;
      const raw = await codexJSON(cfg, prompts.replanPrompt(project, instruction, outPath), outPath, project.dir, job, refPaths(project));
      const next = normalizePlan(project, raw);
      project.history = (project.history || []).concat([{ at: Date.now(), instruction }]);
      project.plan = next; project.title = next.title || project.title;
      initStickers(project);
      for (const st of project.stickers) {
        const b = before.stickers.find((x) => x.no === st.no), a = next.stickers.find((x) => x.no === st.no);
        if (b && a && JSON.stringify([b.phrase, b.expression, b.pose, b.framing, b.angle, b.props, b.who, b.motion]) !== JSON.stringify([a.phrase, a.expression, a.pose, a.framing, a.angle, a.props, a.who, a.motion])) st.status = 'pending';
      }
      setStatus(cfg, project, 'planned', '企画を手直ししました（確認して「描き始める」）');
      setStage(job, 'done', '完了', 100, '');
    } catch (e) {
      setStatus(cfg, project, 'error', '失敗', e.message);
      job.error = e.message; setStage(job, 'error', '失敗', job.progress, '');
    }
  });
  return job;
}

/** 指定した 1 個だけ作り直す（セリフ変更・指示付き） */
function regenerate(cfg, project, no, instruction, patch) {
  if (!project.plan) throw new Error('まだ企画がありません');
  // 複数番号（[1,2,3] や "1,2,3"）もまとめて作り直せる。まとめて描いてアニメも並列で組むので 1 個ずつより速い
  const nos = (Array.isArray(no) ? no : String(no).split(',')).map((n) => parseInt(n, 10)).filter((n) => Number.isInteger(n));
  if (!nos.length) throw new Error('スタンプ番号を指定してください');
  const sts = [];
  for (const n of nos) {
    const plan = project.plan.stickers.find((p) => p.no === n);
    const st = (project.stickers || []).find((x) => x.no === n);
    if (!plan || !st) throw new Error(`${z2(n)} というスタンプ番号はありません`);
    if (patch && typeof patch === 'object') {
      for (const k of ['phrase', 'expression', 'pose', 'framing', 'angle', 'props', 'who', 'motion', 'textMotion', 'charMotion', 'textStyle', 'textPlacement']) if (patch[k] !== undefined) plan[k] = String(patch[k]).trim();
      if (plan.phrase) { if (plan.textPlacement === 'なし') plan.textPlacement = '上'; } else plan.textPlacement = 'なし';
    }
    st.history = (st.history || []).concat([{ at: Date.now(), instruction: instruction || '', phrase: plan.phrase }]);
    st.status = 'pending';
    sts.push(st);
  }
  store.saveProject(cfg.dataDir, project);
  const label = nos.map(z2).join(',');
  const job = newJob('regen', `作り直し ${label}`, project.id);
  enqueue(async () => {
    try {
      setStatus(cfg, project, 'running', `${label} を作り直し中`);
      await generateBatches(cfg, project, job, nos.map((n) => ({ no: n, instruction })), `${label} を描き直しています`);
      const drawn = sts.filter((st) => st.status === 'drawn');
      if (spec(project.kind).animated && drawn.length) await animateAll(cfg, project, job, drawn);
      const bad = sts.filter((st) => st.status !== 'done');
      setStage(job, 'export', 'ZIP を更新中', 95, '');
      try { exportSet(cfg, project); } catch {}
      if (bad.length) throw new Error(bad.map((st) => `${z2(st.no)}: ${st.issue || '作り直しに失敗しました'}`).join(' / '));
      setStatus(cfg, project, 'done', '完成');
      setStage(job, 'done', '完了', 100, '');
    } catch (e) {
      setStatus(cfg, project, 'error', '失敗', e.message);
      job.error = e.message; setStage(job, 'error', '失敗', job.progress, '');
    }
  });
  return job;
}

// ---- 6. まとめる ----
/**
 * 完成済みの複数セットを 1 つのセットにまとめる（例: アシュラ 8 + モブ太 8 + 掛け合い 8 → アニメ 24 個）。
 * 個数が多いほどお得感が出て選ばれやすいので、同じ種類のセットは上限（静止画 40 / アニメ 24）までまとめて出せるようにする。
 * スタンプ・決めポーズ・アニメのコマ・文字画像を番号を振り直してコピーし、書き出しまで行う。codex は使わない
 */
function mergeSets(cfg, ids, title) {
  const srcs = ids.map((id) => { const p = store.getProject(cfg.dataDir, id); if (!p) throw new Error('セットが見つかりません: ' + id); return p; });
  if (srcs.length < 2) throw new Error('まとめるセットを 2 つ以上指定してください');
  const kind = srcs[0].kind;
  if (srcs.some((p) => p.kind !== kind)) throw new Error('種類の違うセット（静止画とアニメなど）は LINE の決まりで 1 つにまとめられません');
  const s = spec(kind);
  const doneOf = (p) => (p.stickers || []).filter((st) => st.status === 'done' && fs.existsSync(path.join(p.dir, st.file))).sort((a, b) => a.no - b.no);
  const total = srcs.reduce((a, p) => a + doneOf(p).length, 0);
  if (!s.counts.includes(total)) throw new Error(`合計 ${total} 個です。${s.label} は ${s.counts.join(' / ')} 個のどれかにする必要があります`);
  const chars = [];
  for (const p of srcs) for (const c of p.characters) if (!chars.some((x) => x.id === c.id)) chars.push(Object.assign({}, c, { referencePath: path.join(p.dir, c.ref) }));
  const first = srcs[0];
  const project = store.createProject(cfg.dataDir, kind, total, chars, { title: title || first.plan.title, mergedFrom: ids });
  const work = path.join(project.dir, 'work');
  const plan = Object.assign({}, first.plan, { title: title || first.plan.title, stickers: [] });
  project.stickers = [];
  let no = 0;
  for (const p of srcs) {
    for (const st of doneOf(p)) {
      no++;
      const old = st.no;
      const cp = (from, to) => { if (fs.existsSync(from)) fs.copyFileSync(from, to); };
      cp(path.join(p.dir, st.file), stickerPath(project, no));
      cp(rawPath(p, old), rawPath(project, no));
      cp(textPath(p, old), textPath(project, no));
      for (const f of fs.readdirSync(path.join(p.dir, 'work'))) {
        const m = f.match(new RegExp(`^frame_${z2(old)}_(\\d+)\\.png$`));
        if (m) cp(path.join(p.dir, 'work', f), path.join(work, `frame_${z2(no)}_${m[1]}.png`));
      }
      const ps = (p.plan.stickers || []).find((x) => x.no === old) || {};
      // 元セットの "both" は、まとめた後も同じ 2 人を指すように id を書き出す
      const who = prompts.whoIds(p, ps.who).join('+');
      plan.stickers.push(Object.assign({}, ps, { no, who: chars.length === 2 && who.includes('+') ? 'both' : who }));
      project.stickers.push(Object.assign({}, st, { no, file: `stickers/${z2(no)}.png`, history: [], from: `${p.id}#${z2(old)}` }));
      if (p === first && old === first.plan.mainNo) plan.mainNo = no;
      if (p === first && old === first.plan.tabNo) plan.tabNo = no;
    }
  }
  project.plan = plan;
  project.title = plan.title;
  project.status = 'done'; project.statusLabel = '完成（まとめたセット）';
  store.saveProject(cfg.dataDir, project);
  exportSet(cfg, project);
  return project;
}

async function environment() {
  return { codex: await which('codex') };
}

module.exports = { mergeSets, freeAllowed, submit, generate, savePlan, replan, regenerate, recompose, exportSet, listJobs, waitIdle, environment };
