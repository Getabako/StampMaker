#!/bin/bash
# ============================================================
#  LINEスタンプメーカー 起動スクリプト（アシュラ奥義 共通・自動生成）
#  「起動して」= このファイルを実行するだけ。判断は一切しない。
#  依存導入 → （必要なら）ビルド → サーバー起動 → ブラウザ表示 まで全部やる。
#  実行: bash ashura-start.sh     停止: bash ashura-start.sh stop
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1

TOOL_NAME="LINEスタンプメーカー"
KIND="node"                 # next-cli / next-start / node
START_CMD='node bin/cli.js'           # __PORT__ を含む場合は空きポートを埋める
PORT_HINT=4594
SELF_OPENS=1       # 1 = サーバー自身がブラウザを開くので二重に開かない
# (追加の環境変数なし)

STATE_DIR=".ashura"; mkdir -p "$STATE_DIR"
LOG="$STATE_DIR/server.log"; PIDF="$STATE_DIR/server.pid"; URLF="$STATE_DIR/server.url"

say()  { printf "\033[36m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[32m✓ %s\033[0m\n" "$*"; }
fail() { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; }
open_url() { case "$(uname)" in Darwin) open "$1" ;; *) (xdg-open "$1" >/dev/null 2>&1 || true) ;; esac; }
responds() { curl -s -o /dev/null --max-time 2 "$1"; }
alive() { [ -f "$PIDF" ] && kill -0 "$(cat "$PIDF" 2>/dev/null)" 2>/dev/null; }
kill_tree() { local p="$1"; for c in $(pgrep -P "$p" 2>/dev/null); do kill_tree "$c"; done; kill "$p" 2>/dev/null || true; }

# --- PATH を整える（Finder / Terminal / Codex どこから呼ばれても node が見えるように） ---
[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
[[ -x /usr/local/bin/brew ]] && eval "$(/usr/local/bin/brew shellenv)"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

if [ "${1:-}" = "stop" ]; then
  if alive; then kill_tree "$(cat "$PIDF")"; ok "$TOOL_NAME を停止しました"; else echo "$TOOL_NAME は起動していません"; fi
  rm -f "$PIDF" "$URLF"; exit 0
fi

echo ""
echo "=================================================="
echo "  $TOOL_NAME を起動します"
echo "=================================================="

# --- ASHURA_VERSION_BLOCK（起動中の更新）: 古い版で動いているサーバーを止める -----------------------
if alive && [ -z "${ASHURA_NO_UPDATE:-}" ]; then
  ASHURA_STALE=""
  [ -f .next/BUILD_ID ] && [ .next/BUILD_ID -nt "$PIDF" ] && ASHURA_STALE="作り直した新しい画面に切り替えます"
  if [ -z "$ASHURA_STALE" ] && command -v curl >/dev/null 2>&1; then
    ashura_mine=""; [ -f "$STATE_DIR/version.txt" ] && ashura_mine="$(tr -d '\r\n' < "$STATE_DIR/version.txt" | cut -c1-40)"
    [ "$(curl -fsS --max-time 8 "https://service.if-juku.net/api/ashura/versions?id=stamp-maker&have=$ashura_mine&format=status" 2>/dev/null)" = "update" ] && ASHURA_STALE="新しい版が出ているので更新します"
  fi
  if [ -n "$ASHURA_STALE" ]; then
    say "動いている $TOOL_NAME は古い版です。いったん止めて、$ASHURA_STALE"
    kill_tree "$(cat "$PIDF")"; rm -f "$PIDF" "$URLF"; sleep 1
  fi
fi
# --- ASHURA_VERSION_BLOCK ここまで ------------------------------------------------------

# 0. 既に起動中ならブラウザを開くだけ
if alive && [ -s "$URLF" ] && responds "$(cat "$URLF")"; then
  URL="$(cat "$URLF")"
  ok "$TOOL_NAME は起動済みです: $URL"
  open_url "$URL"
  echo "ASHURA_URL=$URL"
  exit 0
fi
rm -f "$PIDF" "$URLF"

# --- ASHURA_VERSION_BLOCK: 版の確認と自動更新 --------------------------------------------
# 起動のたびに手元の版と最新版を照らし合わせ、更新があればその場で取り込む。
# 会員が手を加えた所は 3方向マージで残す（インストーラと同じヘルパーを使う）。
# 何が起きても起動は止めない。更新したくない人は ASHURA_NO_UPDATE=1 を付けて実行する。
ART_ID="stamp-maker"
ASHURA_API="https://service.if-juku.net/api/ashura/versions"
ashura_api() { curl -fsS --max-time 8 "$ASHURA_API?id=$ART_ID&$1" 2>/dev/null; }

# zip の展開。macOS の unzip は日本語のファイル名を落として異常終了するので、
# まず ditto を使う（ashura くんの画像など、名前が日本語のファイルがある奥義がある）
ashura_unzip() { # $1=zip $2=展開先
  mkdir -p "$2"
  if [ "$(uname)" = "Darwin" ] && command -v ditto >/dev/null 2>&1; then
    ditto -x -k "$1" "$2" 2>/dev/null && return 0
  fi
  unzip -qq -O UTF-8 "$1" -d "$2" >/dev/null 2>&1 && return 0
  unzip -qq "$1" -d "$2" >/dev/null 2>&1 && return 0
  [ -n "$(ls -A "$2" 2>/dev/null)" ]
}

ashura_self_update() {
  if [ "$(uname)" != "Darwin" ] && ! command -v unzip >/dev/null 2>&1; then
    fail "unzip が無いため自動更新できません。配布ページのコマンドで更新してください"; return 0
  fi
  say "最新版に更新しています（あなたが手を加えた所は残します）…"
  local t; t="$(mktemp -d)" || return 0
  if ! curl -fsSL --max-time 600 -o "$t/app.zip" "https://service.if-juku.net/api/ashura/download/$ART_ID"; then
    fail "更新版を取得できませんでした。今の版のまま起動します"; rm -rf "$t"; return 0
  fi
  if ! ashura_unzip "$t/app.zip" "$t/src"; then
    fail "更新版を開けませんでした。今の版のまま起動します"; rm -rf "$t"; return 0
  fi
  local src; src="$(find "$t/src" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  if [ -z "$src" ]; then fail "更新版の中身が見つかりません。今の版のまま起動します"; rm -rf "$t"; return 0; fi
  # 聞かれて手が止まらないよう、必ず非対話で走らせる（迷ったら会員のファイルを残す側に倒れる）
  if ! curl -fsSL --max-time 30 -o "$t/merge.sh" "https://service.if-juku.net/Ashura/installers/lib/merge-update.sh" \
     || ! bash "$t/merge.sh" "$src" "$PWD" "$t/app.zip" < /dev/null; then
    fail "更新の取り込みに失敗しました。今の版のまま起動します（配布ページのコマンドで更新できます）"
    rm -rf "$t"; return 0
  fi
  ashura_api "format=sha" > "$STATE_DIR/version.txt" 2>/dev/null || true
  rm -rf "$t"
  # zip から取り込んだファイルは時刻が古いままなので「ソースの変更を検知」では作り直しが走らない。
  # 印を消して、このあとの手順で必ず作り直させる（消さないと古い画面のまま起動する）
  rm -f .next/BUILD_ID 2>/dev/null || true
  ok "最新版に更新しました"
  # 更新で必要な部品が変わっていることがあるので、package.json が新しければ入れ直す
  if [ -f package.json ] && [ -d node_modules ] && [ package.json -nt node_modules ]; then
    say "部品（依存パッケージ）を入れ直しています…"
    if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then pnpm install >/dev/null 2>&1 || true
    else npm install >/dev/null 2>&1 || true; fi
  fi
}

ashura_version_check() {
  command -v curl >/dev/null 2>&1 || return 0
  local mine=""
  [ -f "$STATE_DIR/version.txt" ] && mine="$(tr -d '\r\n' < "$STATE_DIR/version.txt" | cut -c1-40)"
  local txt; txt="$(ashura_api "have=$mine&format=text")" || return 0
  if [ -n "$txt" ]; then echo ""; printf '%s\n' "$txt"; fi
  local st; st="$(ashura_api "have=$mine&format=status")" || return 0
  [ "$st" = "update" ] || return 0
  if [ -n "${ASHURA_NO_UPDATE:-}" ]; then
    echo "  （自動更新は切ってあります。ASHURA_NO_UPDATE を外すと自動で更新します）"; return 0
  fi
  ashura_self_update
}
ashura_version_check
# --- ASHURA_VERSION_BLOCK ここまで ------------------------------------------------------

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js が見つかりません。https://nodejs.org から LTS 版を入れて、もう一度このファイルを実行してください。"
  fail "（Mac で Homebrew がある場合: brew install node）"
  exit 1
fi
MAJOR="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$MAJOR" -lt 20 ]; then fail "Node.js 20 以上が必要です（現在 $(node -v)）。更新してから再実行してください。"; exit 1; fi
command -v codex >/dev/null 2>&1 || echo "  注意: codex CLI が見つかりません。画面は開きますが、生成機能には codex が必要です（brew install codex または npm i -g @openai/codex）"
# codex は古いと新しいモデル（gpt-5.6-sol 以降）を使えないので、0.150 未満なら自動で更新する
if command -v codex >/dev/null 2>&1; then
  CV="$(codex --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+' | head -1)"
  CMAJ="${CV%%.*}"; CMIN="${CV#*.}"
  if [ "${CMAJ:-0}" -eq 0 ] && [ "${CMIN:-0}" -lt 150 ]; then
    say "codex を最新に更新しています（新しいAIモデルに対応するため）…"
    npm i -g @openai/codex@latest >/dev/null 2>&1 || brew upgrade codex >/dev/null 2>&1 || true
  fi
fi

# 2. 依存パッケージ（初回のみ）
if [ -f package.json ] && [ ! -d node_modules ]; then
  say "初回のみ: 部品（依存パッケージ）を入れています。数分かかります…"
  if [ -f pnpm-lock.yaml ]; then
    if command -v pnpm >/dev/null 2>&1; then pnpm install || { fail "pnpm install に失敗"; exit 1; }
    else npx --yes pnpm@9 install || npm install || { fail "依存の導入に失敗"; exit 1; }; fi
  else
    npm install || { fail "npm install に失敗"; exit 1; }
  fi
  ok "部品の導入が終わりました"
fi

# 3. ビルド（Next.js 系のみ。初回と、改造でソースが変わった時だけ）
if [ "$KIND" = "next-cli" ] || [ "$KIND" = "next-start" ]; then
  NEED=0
  [ -f .next/BUILD_ID ] || NEED=1
  [ "$KIND" = "next-cli" ] && [ ! -f .next/standalone/server.js ] && NEED=1
  if [ "$NEED" = 0 ]; then
    CHANGED="$(find app lib components src pages -type f -newer .next/BUILD_ID 2>/dev/null | head -1)"
    [ -n "$CHANGED" ] && NEED=1 && say "ソースの変更を検知しました（${CHANGED}）。作り直します"
  fi
  if [ "$NEED" = 1 ]; then
    say "画面を組み立てています（初回と改造後のみ。数分かかります）…"
    if [ -f pnpm-lock.yaml ] && command -v pnpm >/dev/null 2>&1; then pnpm build || { fail "ビルドに失敗"; exit 1; }
    else npm run build || { fail "ビルドに失敗"; exit 1; }; fi
    ok "組み立てが終わりました"
  fi
fi

# 4. サーバー起動（このスクリプトが終わっても生き残るよう nohup で切り離す）
KNOWN_URL=""
if printf '%s' "$START_CMD" | grep -q __PORT__; then
  PORT=$PORT_HINT
  while lsof -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
  START_CMD="${START_CMD//__PORT__/$PORT}"; KNOWN_URL="http://localhost:$PORT"
fi
say "サーバーを起動しています…"
: > "$LOG"
nohup bash -c "$START_CMD" >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDF"
disown 2>/dev/null || true

# 5. URL が応答するまで待つ（最大 120 秒）
URL="$KNOWN_URL"
for _ in $(seq 1 120); do
  [ -z "$URL" ] && URL="$(grep -oE 'https?://(localhost|127\.0\.0\.1):[0-9]+' "$LOG" 2>/dev/null | head -1 || true)"
  if [ -n "$URL" ] && responds "$URL"; then break; fi
  if ! alive; then
    fail "サーバーが途中で終了しました。ログ（${LOG}）の末尾:"; tail -n 30 "$LOG"
    echo ""; fail "上の赤い文字をそのまま Codex に貼って「直して」と頼んでください。"
    exit 1
  fi
  sleep 1
done
if [ -z "$URL" ] || ! responds "$URL"; then
  fail "起動を確認できませんでした。ログ（${LOG}）の末尾:"; tail -n 30 "$LOG"; exit 1
fi
URL="${URL/127.0.0.1/localhost}"
echo "$URL" > "$URLF"

echo ""
echo "=================================================="
ok "$TOOL_NAME 起動完了"
echo "  ブラウザで開く: $URL"
echo "  停止する:       bash ashura-start.sh stop"
echo "=================================================="
echo "ASHURA_URL=$URL"
[ "$SELF_OPENS" = "1" ] || open_url "$URL"
exit 0
