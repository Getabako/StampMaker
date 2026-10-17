// アシュラ会員ライセンス判定（StampMaker版）
//
// 方針（フェイルオープン設計）:
//   - サーバが明確に「invalid」と答えたときだけフリー版に降格する
//   - サーバに繋がらない/エラー/タイムアウト時は、30日以内の認証キャッシュが
//     あればフル版で動かす（会員に絶対に迷惑をかけない）
//   - キー未設定・一度も認証成功していない場合のみフリー版
//
// 会員キーの置き場所（優先順）:
//   1. 環境変数 ASHURA_MEMBER_KEY
//   2. リポジトリ直下の ashura-key.txt（会員はここに貼るだけ）
//   3. ~/.ashura/member.json の {"key": "..."}

'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const TOOL_NAME = 'StampMaker';
const CACHE_FILE = 'stampmaker-license-cache.json';
const FREE_MESSAGE = 'フリー版です（静止画スタンプを 8 個まで作れます）。16 個以上・BIG・メッセージ・アニメーション・絵文字はアシュラ会員限定です。';

const DEFAULT_LICENSE_URL =
  'https://script.google.com/macros/s/AKfycbw3cuKZaSqCgqFTK3C-uVjCKaea3MKNQD_1zl0nZiaJ2AMV6xQzmmKrXNHZjaoIeXsE/exec';

const VERIFY_TIMEOUT_MS = 6000;
const CACHE_TTL_DAYS = 30;

// フリー版のとき、画面下部に表示するクレジット
const FREE_CREDIT = 'アシュラ LINEスタンプメーカー フリー版 - https://service.if-juku.net/Ashura';

function ashuraHome() {
  return process.env.ASHURA_HOME || path.join(os.homedir(), '.ashura');
}

function cachePath() {
  return path.join(ashuraHome(), CACHE_FILE);
}

function licenseUrl() {
  return process.env.ASHURA_LICENSE_URL || DEFAULT_LICENSE_URL;
}

function readMemberKey() {
  const envKey = (process.env.ASHURA_MEMBER_KEY || '').trim();
  if (envKey) return envKey;
  const candidates = [
    path.join(process.cwd(), 'ashura-key.txt'),
    path.join(ashuraHome(), 'member.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, 'utf8');
      if (p.endsWith('.json')) {
        const key = String(JSON.parse(raw).key || '').trim();
        if (key) return key;
      } else {
        const key = raw.trim().split(/\s+/)[0] || '';
        if (key) return key;
      }
    } catch {}
  }
  return '';
}

// キャッシュ形式: { verifiedAt: number, premiumPrompt: string }
function readCache() {
  try {
    const c = JSON.parse(fs.readFileSync(cachePath(), 'utf8'));
    if (!c.verifiedAt) return null;
    const ageDays = (Date.now() - c.verifiedAt) / 86_400_000;
    return ageDays <= CACHE_TTL_DAYS ? c : null;
  } catch {
    return null;
  }
}

function writeCache(premiumPrompt) {
  try {
    fs.mkdirSync(ashuraHome(), { recursive: true });
    fs.writeFileSync(
      cachePath(),
      JSON.stringify({ verifiedAt: Date.now(), premiumPrompt: premiumPrompt }),
    );
  } catch {}
}

function clearCache() {
  try { fs.rmSync(cachePath(), { force: true }); } catch {}
}

// メールアドレスで会員認証し、成功したらキーを ~/.ashura/member.json に保存する。
// 一度成功すれば全奥義が共通でこのキーを使う（以後は resolveLicense が full を返す）。
// 戻り値: { activated: boolean, message: string }
async function activateByEmail(email) {
  const trimmed = String(email || '').trim();
  if (!trimmed || !trimmed.includes('@')) {
    return { activated: false, message: 'メールアドレスの形式が正しくありません。' };
  }
  const url = licenseUrl();
  if (!url) return { activated: false, message: '認証サーバが未設定です。' };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(
      `${url}?action=activate&email=${encodeURIComponent(trimmed)}`,
      { signal: controller.signal, redirect: 'follow' },
    );
    clearTimeout(timer);
    const data = await res.json();
    if (data.ok && data.status === 'active' && data.key) {
      fs.mkdirSync(ashuraHome(), { recursive: true });
      fs.writeFileSync(
        path.join(ashuraHome(), 'member.json'),
        JSON.stringify({ key: data.key, email: trimmed }),
      );
      return {
        activated: true,
        message: '会員認証が完了しました。すべての奥義がフル機能で使えます。',
      };
    }
    if (data.ok && data.status === 'invalid') {
      const why =
        data.reason === 'membership_inactive'
          ? '会員契約が確認できませんでした（会費のお支払い状況をご確認ください）。'
          : 'このメールアドレスは会員登録が見つかりませんでした。';
      return {
        activated: false,
        message: why + ' 入会・再入会: https://service.if-juku.net/Ashura',
      };
    }
    throw new Error('server error');
  } catch {
    return {
      activated: false,
      message: '認証サーバに接続できませんでした。時間をおいて再度お試しください。',
    };
  }
}

// 戻り値: { mode: 'full' | 'free', message: string, premiumPrompt?: string }
async function resolveLicense() {
  const key = readMemberKey();
  if (!key) {
    return { mode: 'free', message: '会員キー未設定のため ' + FREE_MESSAGE };
  }
  const url = licenseUrl();
  if (!url) {
    return { mode: 'full', message: 'ライセンスサーバ未設定（フル版で動作）' };
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), VERIFY_TIMEOUT_MS);
    const res = await fetch(
      `${url}?action=verify&key=${encodeURIComponent(key)}`,
      { signal: controller.signal, redirect: 'follow' },
    );
    clearTimeout(timer);
    const data = await res.json();

    if (data.ok && data.status === 'active') {
      const premiumPrompt = (data.payload && data.payload.premiumPrompt) || '';
      writeCache(premiumPrompt);
      return { mode: 'full', message: '会員認証OK（フル版で使えます）', premiumPrompt: premiumPrompt };
    }
    if (data.ok && data.status === 'invalid') {
      clearCache();
      const why =
        data.reason === 'membership_inactive'
          ? '会員契約が確認できませんでした。'
          : '会員キーが確認できませんでした。';
      return {
        mode: 'free',
        message:
          why + ' ' + FREE_MESSAGE + ' 再入会・お問い合わせ: https://service.if-juku.net/Ashura',
      };
    }
    throw new Error('license server error');
  } catch {
    const cache = readCache();
    if (cache) {
      return {
        mode: 'full',
        message: '認証サーバに接続できないため、認証キャッシュでフル版動作中',
        premiumPrompt: cache.premiumPrompt,
      };
    }
    return { mode: 'free', message: '認証サーバに接続できません。' + FREE_MESSAGE };
  }
}

module.exports = { TOOL_NAME, FREE_CREDIT, readMemberKey, resolveLicense, activateByEmail };

// 単体実行用: node lib/ashura/license.js で判定結果を表示
if (require.main === module) {
  resolveLicense().then((r) => {
    console.log(JSON.stringify(r, null, 2));
  });
}
