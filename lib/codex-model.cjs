// いつも最新のモデルを使う（2026-10-22 山﨑さんの指示「毎回、codex の一覧からいちばん新しいモデルを自動で選ぶ」）。
// codex の「モデルの一覧」（`codex debug models`。codex の更新と OpenAI 側の一覧に合わせて変わる）を読み、
// 一覧に出ている（visibility=list）・おすすめの順番（priority）がいちばん上のモデルを選ぶ。
// そのモデルに後継（upgrade）が指定されていれば後継を使う。一覧が読めないときだけ FALLBACK_MODEL を使う。
// 一覧は 1 時間だけ覚えておく（毎回 codex を起こさないため）。
const { execFileSync } = require("node:child_process");

/** 一覧が読めないときに使うモデル（2026-10-22 時点の一覧の先頭） */
const FALLBACK_MODEL = "gpt-6.1-sol";
const CACHE_MS = 60 * 60_000;
/** 一覧に出ていても、ふつうの仕事には使わない用途専用のモデル */
const EXCLUDE = new Set(["codex-auto-review"]);

/** @type {{ at: number, model: string } | null} */
let cache = null;

/**
 * 一覧からモデルを選ぶ（選べなければ null）
 * @param {any} catalog
 * @returns {string | null}
 */
function pickLatestModel(catalog) {
  const raw = catalog?.models;
  /** @type {any[]} */
  const models = Array.isArray(raw) ? raw : [];
  const bySlug = new Map(models.map((m) => [m?.slug, m]));
  const usable = models
    .filter((m) => typeof m?.slug === "string" && m.visibility === "list" && !EXCLUDE.has(m.slug))
    .sort((a, b) => Number(a.priority ?? 999) - Number(b.priority ?? 999));
  let m = usable[0];
  if (!m) return null;
  // 後継が指定されていれば、たどる（行き来しないよう回数を限る）
  for (let i = 0; i < 5 && typeof m.upgrade?.model === "string" && bySlug.has(m.upgrade.model); i++) m = bySlug.get(m.upgrade.model);
  if (typeof m.upgrade?.model === "string" && !bySlug.has(m.upgrade.model)) return m.upgrade.model;
  return m.slug;
}

/**
 * 今使うモデル（codex の一覧のいちばん上）
 * @returns {string}
 */
function latestCodexModel() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.model;
  let model = FALLBACK_MODEL;
  try {
    const out = execFileSync("codex", ["debug", "models"], {
      encoding: "utf8",
      timeout: 20_000,
      stdio: ["ignore", "pipe", "ignore"],
      windowsHide: true,
      shell: process.platform === "win32",
    });
    model = pickLatestModel(JSON.parse(out)) ?? FALLBACK_MODEL;
  } catch {
    // 一覧が読めないときは予備のモデル
  }
  cache = { at: Date.now(), model };
  return model;
}

module.exports = { FALLBACK_MODEL, pickLatestModel, latestCodexModel };
