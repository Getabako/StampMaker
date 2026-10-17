#!/usr/bin/env node
/*
 * LINEスタンプメーカー 〜売れるスタンプを企画から書き出しまで〜 — ローカル起動サーバ / コマンドライン制作
 * 依存パッケージなし（Node 標準のみ）。静的ファイルを配信し、空きポートで起動してブラウザを自動で開く。
 * 生成はすべて codex CLI（サブスク）。有料 API は使わない。データはすべて ~/StampMaker-data/ に保存（外部送信なし）。
 *
 *   node bin/cli.js                              … サーバー起動（UI モード）
 *   node bin/cli.js run <brief.json>             … 画面なしで 1 セット作り切る（企画→画像→ZIP）
 *   node bin/cli.js plan <brief.json>            … 企画（セリフ一覧）だけ作る
 *   node bin/cli.js generate <setId>             … 企画済みのセットを描いて ZIP まで
 *   node bin/cli.js recompose <setId>            … アニメを描いたコマから組み直す（文字の動きの調整後など・codex 不要）
 *   node bin/cli.js regen <setId> <no> [指示]    … 作り直す（<no> は 3 や 1,2,5 のように複数可）
 *   node bin/cli.js export <setId>               … ZIP を作り直す
 *   node bin/cli.js merge "<タイトル>" <setId> <setId> ...  … 同じ種類のセットを 1 つにまとめる（静止画 40 / アニメ 24 まで）
 *   node bin/cli.js characters                   … 登録済みキャラクター一覧
 */
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const { resolveLicense, activateByEmail, FREE_CREDIT } = require('../lib/ashura/license.js');
const configMod = require('../lib/stamp/config.js');
const store = require('../lib/stamp/store.js');
const pipeline = require('../lib/stamp/pipeline.js');
const { SPECS, TEXT_LIMITS } = require('../lib/stamp/specs.js');

const ROOT = path.resolve(__dirname, '..');
const START_PORT = parseInt(process.env.PORT || '4594', 10);

// --- アシュラ会員ライセンス ---
let licensePromise = null;
function getLicense() {
  if (!licensePromise) {
    licensePromise = resolveLicense().then((l) => Object.assign(l, { freeCredit: FREE_CREDIT })).catch(() => ({ mode: 'free', message: 'ライセンス判定に失敗したためフリー版で動作します。', freeCredit: FREE_CREDIT }));
  }
  return licensePromise;
}

// --- 共通ヘルパ ---
function sendJSON(res, obj, status) {
  res.writeHead(status || 200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > (limit || 5e6)) req.destroy(); });
    req.on('end', () => resolve(body));
    req.on('error', () => resolve(body));
  });
}
async function readJSONBody(req) { try { return JSON.parse(await readBody(req)) || {}; } catch { return {}; } }
function openPath(p) {
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
  exec(`${opener} "${p}"`, () => {});
}
function specsForClient() {
  const out = {};
  for (const [k, s] of Object.entries(SPECS)) out[k] = { label: s.label, short: s.short, counts: s.counts, animated: s.animated, hint: s.hint, size: s.sticker };
  return out;
}

// --- API ---
async function handleActivate(req, res) {
  const { email } = await readJSONBody(req);
  try {
    const r = await activateByEmail(String(email || ''));
    if (r.activated) { licensePromise = null; await getLicense(); }
    sendJSON(res, r);
  } catch (e) { sendJSON(res, { activated: false, message: e.message }, 500); }
}
function handleLicense(req, res) {
  getLicense().then((lic) => sendJSON(res, { mode: lic.mode, message: lic.message, freeCredit: FREE_CREDIT, freeRule: '静止画 8 個まで' }));
}
async function handleConfigGet(req, res) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { config: cfg, configPath: configMod.CONFIG_PATH, specs: specsForClient(), textLimits: TEXT_LIMITS, characters: store.listCharacters(cfg.dataDir).map(publicChar), env: await pipeline.environment() });
}
async function handleConfigPost(req, res) {
  const body = await readJSONBody(req);
  try { const cfg = configMod.saveConfig(body); sendJSON(res, { ok: true, config: cfg, env: await pipeline.environment() }); }
  catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function publicChar(c) { return { id: c.id, name: c.name, description: c.description, speech: c.speech, bundled: !!c.bundled, image: `/characters/${encodeURIComponent(c.id)}/reference.png` }; }
function handleCharacters(req, res) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { characters: store.listCharacters(cfg.dataDir).map(publicChar) });
}
async function handleCharacterAdd(req, res) {
  const body = await readJSONBody(req);
  const cfg = configMod.loadConfig();
  try { const c = store.addCharacter(cfg.dataDir, body, String(body.imagePath || '').trim().replace(/^~(?=$|\/)/, require('os').homedir())); sendJSON(res, { ok: true, character: publicChar(c) }); }
  catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function handleCharacterDelete(req, res, id) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { ok: store.deleteCharacter(cfg.dataDir, id) });
}
function serveCharacterImage(req, res, id) {
  const cfg = configMod.loadConfig();
  const c = store.getCharacter(cfg.dataDir, id);
  if (!c) { res.writeHead(404); return res.end('Not Found'); }
  serveFile(res, c.referencePath, { 'Cache-Control': 'no-store' });
}

function parseCreate(body) {
  const kind = String(body.kind || 'static');
  const count = parseInt(body.count, 10);
  const characterIds = Array.isArray(body.characterIds) ? body.characterIds.map(String) : String(body.characterId || '').split(',').map((s) => s.trim()).filter(Boolean);
  const brief = Object.assign({}, body.brief || {});
  for (const k of ['title', 'theme', 'audience', 'tone', 'language', 'phrases', 'notes', 'textMode', 'frames']) if (brief[k] != null) brief[k] = String(brief[k]).trim();
  return { kind, count, characterIds, brief };
}
async function handleCreate(req, res) {
  const body = await readJSONBody(req);
  const cfg = configMod.loadConfig();
  const lic = await getLicense();
  try {
    const { kind, count, characterIds, brief } = parseCreate(body);
    const { project, job } = pipeline.submit(cfg, lic, kind, count, characterIds, brief, { auto: body.auto !== false });
    sendJSON(res, { ok: true, projectId: project.id, jobId: job.id });
  } catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function handleSets(req, res) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { sets: store.listProjects(cfg.dataDir), dataDir: cfg.dataDir });
}
function getSet(res, id) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { sendJSON(res, { error: 'not found' }, 404); return null; }
  return { cfg, p };
}
function handleSetGet(req, res, id) {
  const g = getSet(res, id); if (!g) return;
  const { cfg, p } = g;
  const out = Object.assign({}, p, { dir: p.dir, freeCredit: FREE_CREDIT });
  sendJSON(res, out);
}
async function handleSetAction(req, res, id, action, no) {
  const g = getSet(res, id); if (!g) return;
  const { cfg, p } = g;
  const body = await readJSONBody(req);
  const lic = await getLicense();
  try {
    if (action === 'plan') return sendJSON(res, { ok: true, plan: pipeline.savePlan(cfg, p, body).plan });
    if (action === 'replan') { const job = pipeline.replan(cfg, p, String(body.instruction || '').trim() || '全体をより使いやすく'); return sendJSON(res, { ok: true, jobId: job.id }); }
    if (action === 'generate') { const job = pipeline.generate(cfg, lic, p); return sendJSON(res, { ok: true, jobId: job.id }); }
    if (action === 'regen') { const job = pipeline.regenerate(cfg, p, parseInt(no, 10), String(body.instruction || '').trim(), body.patch || null); return sendJSON(res, { ok: true, jobId: job.id }); }
    if (action === 'export') { pipeline.exportSet(cfg, p); return sendJSON(res, { ok: true, outputs: p.outputs }); }
    if (action === 'open') { openPath(body.what === 'zip' && p.outputs && p.outputs.zip ? path.join(p.dir, 'export') : p.dir); return sendJSON(res, { ok: true }); }
    sendJSON(res, { error: 'unknown action' }, 404);
  } catch (e) { sendJSON(res, { error: e.message }, 400); }
}
function handleDelete(req, res, id) {
  const cfg = configMod.loadConfig();
  sendJSON(res, { ok: store.deleteProject(cfg.dataDir, id) });
}
function serveProjectFile(req, res, id, rel) {
  const cfg = configMod.loadConfig();
  const dir = store.projectDir(cfg.dataDir, id);
  if (!dir) { res.writeHead(404); return res.end('Not Found'); }
  const fp = path.normalize(path.join(dir, rel));
  if (!fp.startsWith(dir)) { res.writeHead(403); return res.end('Forbidden'); }
  serveFile(res, fp, { 'Cache-Control': 'no-store' });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.zip': 'application/zip',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
};
function serveFile(res, filePath, extraHeaders) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not Found'); }
    const ext = path.extname(filePath).toLowerCase();
    const h = Object.assign({ 'Content-Type': MIME[ext] || 'application/octet-stream' }, extraHeaders || {});
    if (ext === '.zip') h['Content-Disposition'] = `attachment; filename="${path.basename(filePath)}"`;
    res.writeHead(200, h);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  try {
    const url = (req.url || '/').split('?')[0];
    const m = req.method;
    const seg = url.split('/').filter(Boolean).map((s) => { try { return decodeURIComponent(s); } catch { return s; } });

    if (seg[0] === 'api') {
      const a = seg[1];
      if (m === 'GET' && a === 'license') return handleLicense(req, res);
      if (m === 'POST' && a === 'activate') return handleActivate(req, res);
      if (m === 'GET' && a === 'config') return handleConfigGet(req, res);
      if (m === 'POST' && a === 'config') return handleConfigPost(req, res);
      if (a === 'characters') {
        if (m === 'GET') return handleCharacters(req, res);
        if (m === 'POST' && !seg[2]) return handleCharacterAdd(req, res);
        if (m === 'DELETE' && seg[2]) return handleCharacterDelete(req, res, seg[2]);
      }
      if (m === 'POST' && a === 'create') return handleCreate(req, res);
      if (m === 'GET' && a === 'jobs') return sendJSON(res, { jobs: pipeline.listJobs() });
      if (a === 'sets') {
        if (m === 'GET' && !seg[2]) return handleSets(req, res);
        if (m === 'GET' && seg[2] && !seg[3]) return handleSetGet(req, res, seg[2]);
        if (m === 'DELETE' && seg[2]) return handleDelete(req, res, seg[2]);
        if (m === 'POST' && seg[2] && seg[3] === 'stickers' && seg[4] && seg[5] === 'regen') return handleSetAction(req, res, seg[2], 'regen', seg[4]);
        if (m === 'POST' && seg[2] && seg[3]) return handleSetAction(req, res, seg[2], seg[3]);
      }
      if (m === 'POST' && a === 'open-data-dir') { openPath(configMod.loadConfig().dataDir); return sendJSON(res, { ok: true }); }
      return sendJSON(res, { error: 'not found' }, 404);
    }
    if (seg[0] === 'files' && seg[1]) return serveProjectFile(req, res, seg[1], seg.slice(2).join('/'));
    if (seg[0] === 'characters' && seg[1] && seg[2] === 'reference.png') return serveCharacterImage(req, res, seg[1]);

    let urlPath = decodeURIComponent(url);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = path.normalize(path.join(ROOT, urlPath));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
    serveFile(res, filePath);
  } catch (e) {
    res.writeHead(500); res.end('Server Error');
  }
});

function listen(port, triesLeft) {
  server.once('error', (e) => {
    if (e.code === 'EADDRINUSE' && triesLeft > 0) listen(port + 1, triesLeft - 1);
    else { console.error('起動に失敗しました:', e.message); process.exit(1); }
  });
  server.listen(port, () => {
    const url = `http://localhost:${port}`;
    console.log('');
    console.log('  LINEスタンプメーカー 〜売れるスタンプを企画から書き出しまで〜');
    console.log('  ' + url);
    console.log('  データ保存先: ' + configMod.loadConfig().dataDir);
    console.log('  終了するには Ctrl+C を押してください。');
    console.log('');
    try { fs.mkdirSync(configMod.loadConfig().dataDir, { recursive: true }); } catch {}
    getLicense().catch(() => {});
    if (process.env.STAMPMAKER_NO_OPEN) return;
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start ""' : 'xdg-open';
    exec(`${opener} ${url}`, () => {});
  });
}

// --- コマンドライン ---
function progressTimer(job, tag) {
  return setInterval(() => { process.stdout.write(`\r[stampmaker] ${job.stageLabel} ${job.progress}% ${job.detail ? '- ' + job.detail.slice(0, 70) : ''}   `); }, 2000);
}
function printOutputs(cfg, id) {
  const p = store.getProject(cfg.dataDir, id);
  console.log('');
  if (p.status !== 'done' && p.status !== 'planned') { console.error('[stampmaker] 失敗: ' + p.error); process.exit(1); }
  console.log(`[stampmaker] ${p.statusLabel}: ${p.dir}`);
  if (p.plan) console.log(`  タイトル: ${p.plan.title}`);
  if (p.outputs && p.outputs.zip) {
    console.log(`  ZIP: ${path.join(p.dir, p.outputs.zip)}`);
    if (p.outputs.problems && p.outputs.problems.length) console.log('  要確認: ' + p.outputs.problems.join(' / '));
  }
  const bad = (p.stickers || []).filter((s) => s.status !== 'done');
  if (bad.length) console.log('  未完成: ' + bad.map((s) => String(s.no).padStart(2, '0') + (s.issue ? '(' + s.issue + ')' : '')).join(', '));
  process.exit(0);
}
async function cliCreate(briefPath, auto) {
  const cfg = configMod.loadConfig();
  fs.mkdirSync(cfg.dataDir, { recursive: true });
  const spec = JSON.parse(fs.readFileSync(briefPath, 'utf8'));
  const { kind, count, characterIds, brief } = parseCreate(spec);
  const lic = await getLicense();
  const { project, job } = pipeline.submit(cfg, lic, kind, count, characterIds, brief, { auto });
  console.log(`[stampmaker] ${project.kindLabel} ${project.count} 個 を開始します: ${project.id}`);
  const t = progressTimer(job);
  await pipeline.waitIdle(); clearInterval(t);
  printOutputs(cfg, project.id);
}
async function cliGenerate(id) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { console.error('セットが見つかりません: ' + id); process.exit(1); }
  const lic = await getLicense();
  const job = pipeline.generate(cfg, lic, p);
  const t = progressTimer(job);
  await pipeline.waitIdle(); clearInterval(t);
  printOutputs(cfg, id);
}
async function cliRegen(id, no, instruction) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { console.error('セットが見つかりません: ' + id); process.exit(1); }
  const job = pipeline.regenerate(cfg, p, no, instruction || '', null);
  const t = progressTimer(job);
  await pipeline.waitIdle(); clearInterval(t);
  printOutputs(cfg, id);
}
function cliExport(id) {
  const cfg = configMod.loadConfig();
  const p = store.getProject(cfg.dataDir, id);
  if (!p) { console.error('セットが見つかりません: ' + id); process.exit(1); }
  pipeline.exportSet(cfg, p);
  printOutputs(cfg, id);
}

const [, , cmd, arg, arg2, ...rest] = process.argv;
const fail = (e) => { console.error(e.message); process.exit(1); };
// 終わったら明示的に抜ける（残ったタイマー等で CLI が終了しないのを防ぐ）
const finish = () => process.exit(0);
if (cmd === 'run' && arg) cliCreate(arg, true).then(finish, fail);
else if (cmd === 'plan' && arg) cliCreate(arg, false).then(finish, fail);
else if (cmd === 'generate' && arg) cliGenerate(arg).then(finish, fail);
else if (cmd === 'regen' && arg && arg2) cliRegen(arg, arg2, rest.join(' ')).then(finish, fail);
else if (cmd === 'recompose' && arg) { try { const cfg = configMod.loadConfig(); const p = store.getProject(cfg.dataDir, arg); if (!p) throw new Error('セットが見つかりません: ' + arg); pipeline.recompose(cfg, p); printOutputs(cfg, arg); } catch (e) { fail(e); } }
else if (cmd === 'export' && arg) { try { cliExport(arg); } catch (e) { fail(e); } }
else if (cmd === 'merge' && arg && arg2) { try { const cfg = configMod.loadConfig(); const p = pipeline.mergeSets(cfg, [arg2, ...rest], arg); printOutputs(cfg, p.id); } catch (e) { fail(e); } }
else if (cmd === 'characters') { for (const c of store.listCharacters(configMod.loadConfig().dataDir)) console.log(`${c.id}\t${c.name}\t${c.referencePath}`); }
else listen(START_PORT, 20);
