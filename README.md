# LINEスタンプメーカー 〜売れるスタンプを企画から書き出しまで〜

キャラクター画像 1 枚から、**売れやすい構成のスタンプセット**を企画し、1 個ずつ描き、LINE Creators Market の仕様に合わせて検査して **そのままアップロードできる ZIP** まで作るローカルツールです。

- 種類: スタンプ（静止画）/ BIG / メッセージ / アニメーション（APNG）/ LINE 絵文字
- 生成は codex CLI（ChatGPT サブスク）だけ。有料 API・API キーは不要
- 依存パッケージなし（Node 標準のみ）。透過・リサイズ・APNG・ZIP も自前
- データはすべて `~/StampMaker-data/` に保存。外部送信なし

## 使い方

```bash
node bin/cli.js            # 画面を開く（http://localhost:4594）
```

1. **キャラクター**を選ぶ（同梱: アシュラくん・モブ太。自分のキャラは「キャラクター」タブで透過 PNG と見た目の説明を登録）。**最大 20 人**まで選べ、3 人以上は全員がまんべんなく出る「オールスター」セットになる（1 個に出るのは 1 人か 2 人の掛け合い）
2. **種類と個数**（静止画 32〜40、アニメ 16 がおすすめ）と**テーマ**を入れて「企画を作る」
3. できた**セリフ一覧**を確認・編集（表で直す / AI に手直しさせる）→「描き始める」
4. 完成したら 1 個ずつクリックして**作り直し**（セリフ・表情・ポーズ・指示）。メイン画像・タブ画像も指定できる
5. **ZIP をダウンロード**して LINE Creators Market にアップロード。`export/README.md` に説明文・セリフ一覧・申請メモ
6. 登録画面は `export/line-autofill.html` の一括入力ボタンで、タイトル・説明文（日本語と英語）・コピーライト・作品 URL・補足事項・AI 使用の申告までまとめて入る

## コマンドライン

```bash
node bin/cli.js run examples/mobuta-daily-32.json   # 企画 → 画像 → ZIP まで一気に
node bin/cli.js plan examples/pair-work-24.json     # 企画だけ
node bin/cli.js generate <setId>                    # 企画済みを描く（未完成の分だけ）
node bin/cli.js regen <setId> 03 "文字をもっと大きく"  # 1 個作り直す
node bin/cli.js export <setId>                      # ZIP を作り直す
node bin/cli.js recompose <setId>                   # アニメを描き直さずに動き（文字・キャラ）だけ組み直す
node bin/cli.js merge "タイトル" <setId> <setId>      # 同じ種類のセットを 1 つにまとめる（静止画 40・アニメ 24 まで）
node bin/cli.js characters                          # キャラクター一覧
```

## 売れる構成のために組み込んでいること

- 使用頻度が高い言葉（あいさつ・返事・状況・感情・リアクション）を優先し、テーマ色は 2〜3 割に抑える
- セリフは 2〜7 文字、表情・ポーズは全部変える、審査 NG（宣伝・URL・他社キャラ等）を避ける
- 生成後に codex が全画像を点検し、文字崩れ・キャラ崩れ・背景残りは指示付きで自動で描き直す
- 1 個ずつ「場面」として企画（顔アップ〜引き・角度・小物・マンガ記号）し、単調な企画は自動で手直し
- 文字は黒一色にせず、セリフに合う書体・グラデーション・太い白フチでカラフルに描く
- アニメは大ジャンプ・飛び込みなど大きな動き。さらに文字を 1 文字ずつ跳ねさせ、キャラ全体もジャンプ・ズームで動かす（1 秒 20 コマ × 4 回）
- LINE の仕様（サイズ・偶数・余白・1MB・コマ数・4 秒・文字数）はツール側で自動で合わせる

## 仕様の出典

- [スタンプ制作ガイドライン](https://creator.line.me/ja/guideline/sticker/) / [アニメーション](https://creator.line.me/ja/guideline/animationsticker/) / [BIG](https://creator.line.me/ja/guideline/bigsticker/) / [メッセージ](https://creator.line.me/ja/guideline/messagesticker/) / [絵文字](https://creator.line.me/ja/guideline/emoji/) / [審査ガイドライン](https://creator.line.me/ja/review_guideline/)
- 生成 AI で作ったスタンプは申請時に申告が必要です（販売画面に AI アイコンが付きます）

## ライセンス

アシュラ会員向け配布物。フリー版は静止画 8 個まで。詳細は LICENSE.md。
