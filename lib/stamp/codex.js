// codex CLI（ChatGPT サブスク）の呼び出し。有料 API は一切使わない。
'use strict';
const { spawn, execFile } = require('node:child_process');

const CODEX_TIMEOUT_MS = 40 * 60 * 1000; // 画像生成を複数枚まとめて行うので長め

function which(cmd) {
  return new Promise((resolve) => {
    execFile(process.platform === 'win32' ? 'where' : 'which', [cmd], (err, out) => resolve(!err && !!String(out).trim()));
  });
}

function run(cmd, args, opts) {
  const o = Object.assign({ timeout: 0, onLine: null, cwd: undefined, env: undefined }, opts || {});
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: o.cwd, env: o.env, stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    } catch (e) { reject(e); return; }
    let out = '', err = '', bufOut = '', bufErr = '';
    const timer = o.timeout ? setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, o.timeout) : null;
    const feed = (chunk, isErr) => {
      const s = chunk.toString();
      if (isErr) err += s; else out += s;
      if (!o.onLine) return;
      if (isErr) { bufErr += s; const parts = bufErr.split('\n'); bufErr = parts.pop(); parts.forEach((l) => o.onLine(l, true)); }
      else { bufOut += s; const parts = bufOut.split('\n'); bufOut = parts.pop(); parts.forEach((l) => o.onLine(l, false)); }
    };
    child.stdout.on('data', (c) => feed(c, false));
    child.stderr.on('data', (c) => feed(c, true));
    child.on('error', (e) => { if (timer) clearTimeout(timer); reject(e); });
    child.on('close', (code) => { if (timer) clearTimeout(timer); resolve({ code, out, err }); });
  });
}

function cleanCodexOutput(raw) {
  if (!raw) return '';
  const s = raw.replace(/\x1b\[[0-9;]*m/g, '');
  const kept = s.split('\n').filter((ln) => {
    const t = ln.trim();
    if (!t) return true;
    if (/^\[?\d{4}-\d{2}-\d{2}T/.test(t)) return false;
    if (/^(thinking|codex|tokens used|User instructions|OpenAI Codex|workdir:|model:|provider:|approval:|sandbox:|reasoning|session|--------)/i.test(t)) return false;
    if (/^\[.*\]$/.test(t)) return false;
    return true;
  });
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * codex exec を非対話で実行する。
 * @param {string} prompt
 * @param {object} o { cwd, timeout, model, search: ライブWeb検索を有効にする, images: [絶対パス], onLine }
 */
function runCodex(prompt, o) {
  o = o || {};
  // --search は codex 本体側のフラグ（exec の後ろに置くと落ちる）
  const args = [];
  if (o.search) args.push('--search');
  args.push('exec');
  if (o.model) args.push('-m', o.model);
  for (const img of o.images || []) args.push('-i', img);
  args.push('--sandbox', 'workspace-write', '--dangerously-bypass-approvals-and-sandbox', '--skip-git-repo-check', prompt);
  return run('codex', args, { cwd: o.cwd, timeout: o.timeout || CODEX_TIMEOUT_MS, onLine: o.onLine });
}

function extractJSON(text) {
  if (!text) return null;
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(text.slice(s, e + 1)); } catch { return null; }
}

module.exports = { which, run, runCodex, cleanCodexOutput, extractJSON, CODEX_TIMEOUT_MS };
