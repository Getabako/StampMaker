# LINEスタンプメーカー（StampMaker）— 作業指示

## 二つの使い方（AIモード / UIモード）— 最初の返答で必ず一言案内する

この奥義には 2 つの使い方がある。ユーザーの最初のメッセージへの返答の冒頭に、次の案内を短く添える（長くしない・毎回は不要）:
「この奥義は 2 通りで使えます。**AIモード**: このチャットに『このキャラで毎日使えるスタンプ 32 個作って』『動くスタンプにして』『03 のセリフを変えて作り直して』とそのまま頼む。**UIモード**: 『起動して』と送ると操作画面がブラウザで開きます。」

- **AIモード**: ユーザーが「スタンプを作って」「〇〇のセットを作って」「△△を直して」と言ったら、UI を起動せずに、このフォルダの仕組みでチャット上から結果を作り切る。手順:
  1. キャラクターを確認する: `node bin/cli.js characters`（同梱: `ashura`=アシュラくん、`mobuta`=モブ太）。新しいキャラなら `characters/<id>/reference.png`（透過 PNG）と `character.json`（name / description / speech）を作るか、`~/StampMaker-data/characters/<id>/` に置く
  2. 依頼を `examples/*.json` と同じ形の JSON にまとめる（`kind` = static / big / message / animation / emoji、`count` は種類ごとの選択肢、`characterIds` は 1〜20 人（3 人以上は「オールスター」: 各スタンプの who は 1 人の id か `id+id` の 2 人。企画は全キャラを満遍なく登場させ、偏りは `varietyIssues()` が検出して手直しさせる。描く・点検・コマ作りでは who のキャラの参照画像だけを codex に渡す）、`brief` は theme / audience / tone / textMode / phrases / notes / frames）
  3. `node bin/cli.js run <その JSON>` で企画 → 画像 → 点検 → （アニメ）→ ZIP まで一気に作る。企画だけ先に見せるなら `plan`、その後 `generate <setId>`。**長い（静止画 1 個 1〜2 分、アニメ 1 個 3〜5 分）ので nohup で常駐させて終了を見張る**
  4. 出力は `~/StampMaker-data/sets/<setId>/`。`export/<setId>.zip`（LINE Creators Market にそのままアップロードできる）と `export/README.md`（説明文・セリフ一覧・申請メモ）、`export/line-autofill.html`（登録画面の一括入力。「作品が確認できるURL」「その他、補足事項」は設定の既定値より project.json の `plan.workUrl` / `plan.reviewNote` が優先。既定と違うキャラのセットでは必ずこの 2 つを plan に入れて `export` し直す）、`stickers/NN.png`（各スタンプ）を報告する
  5. **まとめて売る**: 個数が多いほどお得感が出るので、同じ種類のセットは上限までまとめられる。`node bin/cli.js merge "<タイトル>" <setId> <setId> ...`（合計が静止画 8/16/24/32/40・アニメ 8/16/24 のどれかになること。静止画とアニメは LINE の決まりで 1 つにできない）。まとめたら project.json の plan.title / description / titleEn / descriptionEn を新しい中身に合わせて直し、`export <setId>` で書き出し直す
  6. 修正は **1 個単位**: `node bin/cli.js regen <setId> <no> "指示"`（セリフ変更は project.json の plan を直すか UI で）。企画全体の手直しは UI の「手直しする」または plan JSON を直して `generate`
  - 生成はすべて codex CLI（サブスク）の image_gen。**有料 API（OpenAI / Gemini / Claude API 等）は使わない。** codex が 429（上限）を返したら時間を置いて `generate <setId>`（未完成の分だけ描く）
  - ツール自体の改造・カスタマイズもこのモードで行う。直したら `node --check` で確認（ビルド不要・素の node）
- **UIモード**: 「起動して」「UIモード」「画面を開いて」「立ち上げて」等と言われたら、**手順を自分で組み立てず**、次のコマンドをそのまま実行する:
  - macOS / Linux: `bash ashura-start.sh`
  - Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File ashura-start.ps1`

  このスクリプトが Node 確認・サーバー起動・ブラウザ表示まで全部行う。最後に出力される `ASHURA_URL=...` の URL を「起動しました: URL」と 1 行で報告する。
  スクリプトが失敗した時だけ、その出力と `.ashura/server.log` を読んで原因を直し、もう一度 `bash ashura-start.sh` を実行する。停止は `bash ashura-start.sh stop`。

## 起動の作法（手動フォールバック。通常は上記 ashura-start.sh を実行する）

1. Node.js 20 以上があるか確認する（`node --version`）。無ければ `brew install node`
2. 依存パッケージのインストールは不要（Node 標準モジュールのみ。PNG / APNG / ZIP も自前）
3. `node bin/cli.js` で起動（ポート 4594 を起点に空きポートを自動選択）。ブラウザが自動で開く
4. 生成には codex CLI（ChatGPT サブスク）が必要。`codex --version`（0.150 以上）、無ければ `brew install codex`、未ログインなら `codex login`
5. 会員認証について: フリー版は静止画 8 個まで。「画面のメール認証欄にアシュラ会員のメールアドレスを入れると全種類・最大 40 個」と案内する

## 仕組み（直すときに読む）

- `lib/stamp/specs.js` — LINE Creators Market の仕様（サイズ・個数・コマ数・文字数）。公式ガイドラインが変わったらここだけ直す
- `lib/stamp/prompts.js` — codex への指示文。企画（売れる構成ルール）／画像（マゼンタ背景・文字の描き方）／アニメのコマ／点検／企画の手直し
- **絵の豊かさ（2026-10-15 方針）**: 各スタンプは「場面」として企画する（pose は 25〜60 文字の具体的な場面、framing=顔アップ/上半身/全身/引き、angle=正面/斜め/横/後ろ/見上げ/見下ろし、props=小物・場面要素）。正面は 4 割まで、7 割以上に小物・場面要素、マンガ記号は積極的に。企画後に `varietyIssues()` が機械判定し、単調なら codex に 1 回手直しさせる。参照画像の正面立ちポーズをなぞらせない
- `lib/stamp/pipeline.js` — 企画 → 画像（バッチ・並列）→ 点検（文字崩れ・キャラ崩れを codex に見せて不備は指示付きで描き直し）→ アニメ（コマ生成 → 共通枠で切り出し → APNG）→ 書き出し（main / tab / NN.png を仕様検査して ZIP）
- `lib/stamp/image.js` `png.js` `zip.js` — 透過キー（#FF00FF）・トリム・面積平均縮小・合成、PNG/APNG エンコード、ZIP
- 画像は常に「1024 正方形（BIG は縦長）・マゼンタ背景」で描かせ、ツール側でマゼンタだけ透過して枠に収める（白をキャラに残すため。AnimeMaker と同じ方式）
- 文字は image_gen に描かせる。崩れは点検で拾って描き直す。どうしても直らないときは「文字なし」にして逃がす
- **文字のデザイン（2026-10-15 方針）**: 黒一色の単調な文字は NG。企画で 1 個ずつ `textStyle`（セリフの内容に合う書体・グラデや色分けの配色・内フチ/ツヤ/立体影の飾り）を決め、画像・文字画像はそのとおりに描かせる。全スタンプ共通で「いちばん外側は太い白フチ」、ピンク・マゼンタ・紫は抜き色に近いので使わない。アニメの文字画像は 1 文字ずつ切り分けるので、文字から離れた飾りは描かせない
- **アニメの動き（2026-10-15 方針）**: ゆらゆら・小さな傾きは NG。企画の `motion` は大ジャンプ・飛び込み・一回転など大きな動き、コマは「ため → 勢い → 決め → 余韻」で描かせる。さらにツール側（`lib/stamp/textanim.js`）でキャラ全体を `charMotion`（ジャンプ / ぴょんぴょん / ズーム / 左右に揺れる / ぶるぶる / なし。つぶし・伸ばし付き）で動かし、文字は `textMotion`（跳ねる / ぐっと拡大 / 波 / ぶるぶる / くるっと回転 / ポンポン出てくる / びよーん）で 1 文字ずつ動かす。1 秒 20 コマ × 4 ループ、256 色に減色して 1MB 以内に収める（`png.encodeAPNG(..., { indexed: true })`）。文字の切り分け（`textanim.splitGlyphs` / `glyphImages`）は、列の切れ目の塊と文字を「見込み幅（小さい ゃ・っ や ！ は狭い）」で対応づけ、白フチでつながった塊は外側の白を除いた中身で文字ごとに分け、各文字に白フチを丸ごと持たせる（白い切れ目・細い白線を出さない）
- アニメの 1 コマ目は静止画と同じ決めポーズ（一覧に出る静止画になる）。LINE は 1 回の再生が 1〜4 秒ちょうど（端数はアップロードでエラー）なので、コマを 1 回 1 秒に割り振ってループ 4 回（計 4 秒）にする。アニメのメイン画像（main.png）も APNG で書き出す（静止画だとエラー）
