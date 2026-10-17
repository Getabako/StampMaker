// 設定（~/StampMaker-data/config.json）。Node 標準のみ。
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_DATA_DIR = path.join(os.homedir(), 'StampMaker-data');
const CONFIG_PATH = path.join(DEFAULT_DATA_DIR, 'config.json');

const DEFAULTS = {
  dataDir: DEFAULT_DATA_DIR,
  codexModel: '',          // 空なら codex の既定モデル（gpt-5.6-sol）
  creatorName: '',         // LINE Creators Market のクリエイター名（説明文の雛形に使う）
  copyright: '',           // 例: (C) 2026 if-juku
  workUrl: '',             // 登録画面「作品が確認できるURL」（キャラが載っている自分のページ）
  reviewNote: '',          // 登録画面「その他、補足事項」（例: オリジナルキャラクターです）
  batchSize: '5',          // 1 回の codex 呼び出しで作る枚数
  checkImages: '1',        // 生成後に codex で文字崩れ・キャラ崩れを点検する（1=する）
  parallel: '2',           // 同時に走らせる codex の数（画像生成）
};

function loadConfig() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) || {}; } catch {}
  const cfg = Object.assign({}, DEFAULTS, saved);
  cfg.dataDir = String(cfg.dataDir || DEFAULT_DATA_DIR).replace(/^~(?=$|\/)/, os.homedir());
  cfg.batchSizeN = Math.max(1, Math.min(8, parseInt(cfg.batchSize, 10) || 5));
  cfg.parallelN = Math.max(1, Math.min(4, parseInt(cfg.parallel, 10) || 2));
  cfg.checkImagesOn = String(cfg.checkImages) !== '0';
  return cfg;
}

function saveConfig(patch) {
  const cur = loadConfig();
  const next = {};
  for (const k of Object.keys(DEFAULTS)) next[k] = cur[k];
  for (const k of Object.keys(DEFAULTS)) {
    if (patch[k] !== undefined && patch[k] !== null) next[k] = String(patch[k]).trim();
  }
  if (!next.dataDir) next.dataDir = DEFAULT_DATA_DIR;
  next.dataDir = next.dataDir.replace(/^~(?=$|\/)/, os.homedir());
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return loadConfig();
}

module.exports = { loadConfig, saveConfig, CONFIG_PATH, DEFAULTS };
