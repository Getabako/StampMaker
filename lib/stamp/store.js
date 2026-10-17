// セット（案件）とキャラクターの保存。
//   セット: <dataDir>/sets/<id>/project.json + reference_*.png + work/raw_NN.png + stickers/NN.png + export/<id>.zip
//   キャラ: ツール同梱 characters/<id>/ と <dataDir>/characters/<id>/（character.json + reference.png）
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { SPECS } = require('./specs.js');

const ROOT = path.resolve(__dirname, '..', '..');
const BUNDLED_CHAR_DIR = path.join(ROOT, 'characters');

function readJSON(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJSON(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}
function slugify(s) {
  return String(s || '').trim().replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'set';
}
function stamp(d) {
  d = d || new Date();
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`;
}
function safeId(id) { return !!id && !/[\\/]/.test(id) && !id.startsWith('.'); }

// ---- キャラクター ----
function charDirs(dataDir) {
  return [BUNDLED_CHAR_DIR, path.join(dataDir, 'characters')];
}
function listCharacters(dataDir) {
  const out = [];
  const seen = new Set();
  for (const base of charDirs(dataDir)) {
    let names = [];
    try { names = fs.readdirSync(base); } catch { continue; }
    for (const n of names.sort()) {
      const dir = path.join(base, n);
      const meta = readJSON(path.join(dir, 'character.json'), null);
      const ref = path.join(dir, 'reference.png');
      if (!meta || !fs.existsSync(ref) || seen.has(n)) continue;
      seen.add(n);
      out.push(Object.assign({ id: n }, meta, { dir, referencePath: ref, bundled: base === BUNDLED_CHAR_DIR }));
    }
  }
  return out;
}
function getCharacter(dataDir, id) {
  if (!safeId(id)) return null;
  return listCharacters(dataDir).find((c) => c.id === id) || null;
}
function addCharacter(dataDir, meta, imagePath) {
  const name = String(meta.name || '').trim();
  if (!name) throw new Error('キャラクターの名前を入れてください');
  if (!imagePath || !fs.existsSync(imagePath)) throw new Error('参照画像（PNG）のパスが見つかりません: ' + imagePath);
  let id = slugify(meta.id || name).toLowerCase().replace(/[^a-z0-9_-]/g, '') || `char_${stamp()}`;
  if (getCharacter(dataDir, id)) id = `${id}_${stamp()}`;
  const dir = path.join(dataDir, 'characters', id);
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(imagePath, path.join(dir, 'reference.png'));
  const data = { name, description: String(meta.description || '').trim(), speech: String(meta.speech || '').trim(), createdAt: Date.now() };
  writeJSON(path.join(dir, 'character.json'), data);
  return getCharacter(dataDir, id);
}
function deleteCharacter(dataDir, id) {
  const c = getCharacter(dataDir, id);
  if (!c || c.bundled) return false;
  fs.rmSync(c.dir, { recursive: true, force: true });
  return true;
}

// ---- セット ----
function setsDir(dataDir) { return path.join(dataDir, 'sets'); }
function projectDir(dataDir, id) {
  if (!safeId(id)) return null;
  const p = path.join(setsDir(dataDir), id);
  return fs.existsSync(path.join(p, 'project.json')) ? p : null;
}

function createProject(dataDir, kind, count, characters, brief) {
  const s = SPECS[kind];
  if (!s) throw new Error('種類が不正です');
  if (!s.counts.includes(count)) throw new Error(`${s.label} の個数は ${s.counts.join(' / ')} から選んでください`);
  if (!characters.length) throw new Error('キャラクターを選んでください');
  const title = String(brief.title || '').trim() || `${characters.map((c) => c.name).join('と')}の${s.short}スタンプ`;
  const id = `${stamp()}_${slugify(title)}`;
  const dir = path.join(setsDir(dataDir), id);
  fs.mkdirSync(path.join(dir, 'work'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'stickers'), { recursive: true });
  const chars = characters.map((c, i) => {
    const ref = `reference_${i + 1}.png`;
    fs.copyFileSync(c.referencePath, path.join(dir, ref));
    return { id: c.id, name: c.name, description: c.description || '', speech: c.speech || '', ref };
  });
  const project = {
    id, kind, kindLabel: s.label, count, title,
    characters: chars,
    brief,
    plan: null,
    stickers: [],
    status: 'queued', statusLabel: '待機中', error: '',
    outputs: {},
    history: [],
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  writeJSON(path.join(dir, 'project.json'), project);
  project.dir = dir;
  return project;
}

function getProject(dataDir, id) {
  const dir = projectDir(dataDir, id);
  if (!dir) return null;
  const p = readJSON(path.join(dir, 'project.json'), null);
  if (p) p.dir = dir;
  return p;
}

function saveProject(dataDir, project) {
  const dir = path.join(setsDir(dataDir), project.id);
  const copy = Object.assign({}, project);
  delete copy.dir;
  copy.updatedAt = Date.now();
  writeJSON(path.join(dir, 'project.json'), copy);
  project.updatedAt = copy.updatedAt;
  return project;
}

function listProjects(dataDir) {
  let names = [];
  try { names = fs.readdirSync(setsDir(dataDir)); } catch { return []; }
  const out = [];
  for (const n of names) {
    const p = readJSON(path.join(setsDir(dataDir), n, 'project.json'), null);
    if (!p) continue;
    const done = (p.stickers || []).filter((s) => s.status === 'done').length;
    out.push({
      id: p.id, kind: p.kind, kindLabel: p.kindLabel, count: p.count, title: (p.plan && p.plan.title) || p.title,
      characters: (p.characters || []).map((c) => c.name),
      status: p.status, statusLabel: p.statusLabel, done, hasZip: !!(p.outputs && p.outputs.zip),
      mainNo: p.plan && p.plan.mainNo, createdAt: p.createdAt, updatedAt: p.updatedAt,
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function deleteProject(dataDir, id) {
  const dir = projectDir(dataDir, id);
  if (!dir) return false;
  fs.rmSync(dir, { recursive: true, force: true });
  return true;
}

module.exports = { ROOT, readJSON, writeJSON, slugify, stamp, listCharacters, getCharacter, addCharacter, deleteCharacter, createProject, getProject, saveProject, listProjects, deleteProject, projectDir };
