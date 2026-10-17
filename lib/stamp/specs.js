// LINE Creators Market の制作仕様（2026-10 時点の公式ガイドラインを転記）
// 出典: https://creator.line.me/ja/guideline/sticker/ ほか各種別のガイドライン
'use strict';

const SPECS = {
  static: {
    label: 'スタンプ（静止画）',
    short: '静止画',
    counts: [8, 16, 24, 32, 40],
    sticker: { w: 370, h: 320, margin: 10 },   // 最大 370x320。枠と絵の間に約 10px
    main: { w: 240, h: 240 },
    tab: { w: 96, h: 74 },
    animated: false,
    zipName: (i) => `${String(i).padStart(2, '0')}.png`,
    hint: '一番基本。日常会話で使いやすいセリフを中心に 32〜40 個入れるとお得感が出て選ばれやすい。',
  },
  big: {
    label: 'BIGスタンプ',
    short: 'BIG',
    counts: [8, 16, 24, 32, 40],
    sticker: { w: 396, h: 660, margin: 0, minW: 80, minH: 524 }, // 最大 396x660 / 最小 80x524。余白は自動付与
    main: { w: 240, h: 240 },
    tab: { w: 96, h: 74 },
    animated: false,
    zipName: (i) => `${String(i).padStart(2, '0')}.png`,
    hint: '縦長で大きく表示される。全身ポーズや「ドーン」と見せたい感情表現向き。オプション付きは静止画より DL 数が多い傾向。',
  },
  message: {
    label: 'メッセージスタンプ',
    short: 'メッセージ',
    counts: [8, 16, 24],
    sticker: { w: 370, h: 320, margin: 10 },
    main: { w: 240, h: 240 },
    tab: { w: 96, h: 74 },
    animated: false,
    zipName: (i) => `${String(i).padStart(2, '0')}.png`,
    hint: '買った人が最大 100 文字の好きな言葉を入れられる。吹き出しや看板など、文字を置く空白を絵の中に作る。',
  },
  animation: {
    label: 'アニメーションスタンプ',
    short: 'アニメ',
    counts: [8, 16, 24],
    sticker: { w: 320, h: 270, margin: 10 },   // 最大 320x270
    main: { w: 240, h: 240 },
    tab: { w: 96, h: 74 },
    animated: true,
    frames: { min: 5, max: 20 }, maxDurationMs: 4000, loops: { min: 1, max: 4 },
    zipName: (i) => `${String(i).padStart(2, '0')}.png`,
    hint: 'APNG で動く。5〜20 コマ・最大 4 秒。公式資料ではアニメ付きは静止画の約 1.9 倍ダウンロードされる。',
  },
  emoji: {
    label: 'LINE絵文字',
    short: '絵文字',
    counts: [8, 16, 24, 32, 40],
    sticker: { w: 180, h: 180, margin: 0 },    // 180x180、余白なし推奨
    main: null,
    tab: { w: 96, h: 74 },
    animated: false,
    zipName: (i) => `${String(i).padStart(3, '0')}.png`,
    hint: '文中に入れる小さな絵。輪郭を太く濃く、表情の差を大きく。装飾は控えめに。',
  },
};

const TEXT_LIMITS = { title: 40, creator: 50, description: 160, copyright: 50 };
const MAX_FILE_BYTES = 1024 * 1024;

function spec(kind) {
  const s = SPECS[kind];
  if (!s) throw new Error('未対応の種類: ' + kind);
  return s;
}

/** 全角 2・半角 1 で数える（LINE の数え方） */
function lineLength(s) {
  let n = 0;
  for (const ch of String(s || '')) n += ch.charCodeAt(0) > 0xff ? 2 : 1;
  return n;
}

module.exports = { SPECS, TEXT_LIMITS, MAX_FILE_BYTES, spec, lineLength };
