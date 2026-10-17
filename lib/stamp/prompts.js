// codex に渡す指示文。生成（企画 JSON・画像・アニメのコマ・点検）はすべて codex CLI（サブスク）。
// 有料 API は使わない。画像は codex 内蔵の image_gen。
'use strict';
const { spec, TEXT_LIMITS } = require('./specs.js');

const KEY_BG = '#FF00FF（マゼンタ 1 色のベタ塗り。グラデ・模様・影を置かない。キャラの中にマゼンタ系の色を使わない）';

function z2(n) { return String(n).padStart(2, '0'); }

// 1 セットに何人でも入れられる。各スタンプの who は 1 人の id か「id+id」（2 人で掛け合い）。
// "both" は 2 人セットの「2 人とも」（旧形式）。描く・点検するときは who に出てくるキャラの参照画像だけを渡す
function whoIds(project, who) {
  const ids = project.characters.map((c) => c.id);
  if (ids.length === 1) return ids.slice();
  if (who === 'both') return ids.slice(0, 2);
  const list = String(who || '').split('+').map((s) => s.trim()).filter((id) => ids.includes(id));
  return list.length ? Array.from(new Set(list)) : [ids[0]];
}
function charsOf(project, ids) {
  return ids ? project.characters.filter((c) => ids.includes(c.id)) : project.characters;
}
function idsOfStickers(project, stickers) {
  const set = new Set();
  for (const st of stickers) for (const id of whoIds(project, st.who)) set.add(id);
  return project.characters.map((c) => c.id).filter((id) => set.has(id));
}

function charBlock(project, ids) {
  return charsOf(project, ids).map((c) => `### ${c.name}（id: ${c.id} / 参照画像: ${c.ref}）
- 見た目: ${c.description || '参照画像のとおり'}
- 口調: ${c.speech || '自由'}`).join('\n\n');
}

function whoLabel(project, who) {
  return whoIds(project, who).map((id) => project.characters.find((c) => c.id === id).name).join('と');
}

function whoRule(project) {
  const n = project.characters.length;
  if (n < 2) return '';
  if (n === 2) return '\n2 キャラのセットです。各スタンプの who は "' + project.characters[0].id + '" / "' + project.characters[1].id + '" / "both" のどれか。掛け合い（片方が言って片方が反応）や「両方で祝う」など 2 人ならではの絵を 3〜4 割入れる。';
  const ids = project.characters.map((c) => c.id);
  const per = Math.floor(project.count / n);
  return `\n${n} キャラのオールスターセットです。各スタンプの who は 1 人の id（${ids.map((x) => `"${x}"`).join(' / ')}）か、2 人の id を + でつないだもの（例 "${ids[0]}+${ids[1]}"）。3 人以上を 1 枚に描かない。
- **全キャラを満遍なく使う**: どのキャラも最低 ${Math.max(1, per)} 回は登場させ、特定のキャラに偏らせない（1 人で最大 ${per + 2} 回まで）。
- 2 人の掛け合い（片方が言って片方が反応・2 人で祝う・ライバル同士・親子・相棒）を全体の 2〜3 割入れる。設定上の関係（親子・ライバル・恋人・師弟・相棒）を生かした組み合わせにする。
- セリフは各キャラの口調・性格・モチーフ（名物・伝承・持ち物）に合わせる。そのキャラだからこそのセリフと小物にする（誰が言っても同じセリフばかりにしない）。`;
}

/** 1. 企画: 売れやすい構成のセリフ一覧を JSON で出す */
function planPrompt(project, outPath) {
  const s = spec(project.kind);
  const b = project.brief || {};
  const textMode = b.textMode || 'with';
  const kindNotes = {
    static: '静止画スタンプ。1 枚ごとに「表情 + ポーズ + 短いセリフ」。',
    big: 'BIG スタンプ（縦長 396x660）。全身ポーズや大きな感情表現。縦長を生かす構図（上にセリフ、下に全身など）。',
    message: 'メッセージスタンプ。買った人が自分で言葉を入れるので、各スタンプに「空の吹き出し」「空の看板」「空のプラカード」など文字を入れる空白を作る。phrase には空白に入る想定の例文（4〜8 文字）を書く。',
    animation: 'アニメーションスタンプ。各スタンプに motion（5〜8 コマで成立する、**大きくダイナミックな動き**）を必ず書く。小さく揺れるだけ・その場でゆらゆらは NG。例: 大ジャンプして着地 / 画面の奥から飛び込んでくる / くるっと一回転してポーズ / 勢いよく深々とお辞儀して跳ね起きる / 両腕をぶんぶん振り回す / ずっこけて起き上がる / 小物を放り投げてキャッチ / 効果線・紙吹雪・ハート・汗が弾け飛ぶ。1 枚目（静止画として一覧に出る）は決めポーズにする。',
    emoji: 'LINE 絵文字（180x180・文中に入れる小さな絵）。顔アップ中心で表情差を大きく。文字は入れない（phrase は空）。小物・装飾は最小限。',
  };
  const textRule = textMode === 'none'
    ? '文字は入れない（全スタンプの phrase は空文字）。'
    : textMode === 'mixed'
      ? '7 割は短いセリフ入り、3 割は文字なし（表情だけで伝わるもの）。'
      : '全スタンプに短いセリフを入れる（絵文字は除く）。';
  return `あなたは LINE Creators Market で売れているスタンプを多数手がけたプランナーです。
下のキャラクターとテーマで、売れやすい構成のスタンプセットを企画し、**JSON だけ**を ${outPath} に書き出してください（説明文は不要）。

## キャラクター
${charBlock(project)}
${whoRule(project)}

## 種類と個数
- 種類: ${s.label} — ${kindNotes[project.kind]}
- 個数: **ちょうど ${project.count} 個**（no は 1〜${project.count}）
- ${textRule}

## テーマ・狙い（依頼主の入力）
- テーマ: ${b.theme || '日常会話で毎日使えるもの'}
- 想定する使い手: ${b.audience || '幅広い年代の LINE ユーザー'}
- トーン: ${b.tone || 'かわいい・明るい・ゆるい'}
- 言語: ${b.language || '日本語'}
${b.phrases ? `- 必ず入れてほしいセリフ: ${b.phrases}` : ''}
${b.notes ? `- その他の要望: ${b.notes}` : ''}

## 売れるスタンプの構成ルール（必ず守る）
1. **使用頻度が高い言葉を優先**。あいさつ（おはよう / おやすみ / おつかれ）、返事（了解 / OK / ありがとう / ごめん / よろしく）、状況（今向かってる / ちょっと待って / 了解しました）、感情（うれしい / 疲れた / 泣ける / 笑った / びっくり）、リアクション（すごい / えらい / それな / 草）をバランス良く入れる。${project.count >= 24 ? '個数が多いので「仕事でも家族でも使える返事」を厚くする。' : '個数が少ないので、毎日使う言葉だけに絞る。'}
2. **テーマ色は 2〜3 割**。テーマ（上の入力）に寄せたセリフは全体の 2〜3 割に抑え、残りは誰でも使える汎用の言葉にする（テーマだけだと日常で使えず売れない）。
3. **セリフは短く**（2〜7 文字が理想、最大 10 文字）。ひらがな・カタカナ中心で読みやすく。同じ意味の重複を避ける。
4. **表情・ポーズ・構図は 1 枚ずつ全部変える（ワンパターン厳禁）**。同じ「正面・全身・直立」が続くと一覧で単調に見えて売れない。
   - framing（構図）を散らす: 顔アップ 2〜3 割 / 上半身 3〜4 割 / 全身 2〜3 割 / 引き（小さな場面ごと）1 割。
   - angle（向き）を散らす: 正面は全体の 4 割まで。残りは斜め・横向き・後ろ姿（振り返り）・見上げ・見下ろしに。
   - 動きを入れる: 走る・跳ぶ・座る・寝転ぶ・のぞき込む・身を乗り出す・指さす・物を差し出す、など「その瞬間」を切り取る。
   - **豊かにする**: 7 割以上のスタンプに、セリフに合った小物やちょっとした場面要素（机・椅子・ソファ・ふとん・黒板・吹き出し・ハート・花・紙吹雪・汗・効果線・キラキラ等）を入れて、絵だけで状況が伝わるようにする。ただし背景を塗りつぶす風景は描かない（キャラの周りに置く程度）。
   - 腕や顔が多いキャラは、その特徴を「同時に別々のことをしている」演出に使う（毎回同じ広げ方をしない）。
5. **審査 NG を避ける**: 宣伝・URL・サービス名・企業ロゴ・実在人物・他社キャラ・政治・宗教・性的/暴力表現・飲酒喫煙を入れない。風景だけ・物だけの絵も NG。
6. キャラの口調（上記）をセリフに反映する。ただし読みやすさ優先で、語尾は毎回付けなくてよい。
7. **mainNo** は一覧で一番目を引く「笑顔で手を振る / 決めポーズ」の番号、**tabNo** は顔アップの番号にする。
8. title は ${TEXT_LIMITS.title} 文字以内（全角は 2 文字換算）、description は ${TEXT_LIMITS.description} 文字以内で、検索で見つかるキーワード（キャラ名・用途・雰囲気）を自然に入れる。絵文字・URL・宣伝文句は入れない。titleEn（英数字 40 文字以内）・descriptionEn（160 文字以内）は title・description の自然な英訳（直訳しすぎない。「スタンプ」は Sticker と書く）。

## JSON の形式（この形だけを出力）
{
  "title": "スタンプのタイトル",
  "description": "説明文",
  "titleEn": "英語のタイトル（LINE STORE の英語表示用）",
  "descriptionEn": "英語の説明文",
  "concept": "セットのコンセプトを 1〜2 文",
  "style": "全スタンプ共通の絵柄指示（線の太さ・塗り・文字の書体感・配色）を 1〜2 文",
  "mainNo": 1,
  "tabNo": 2,
  "stickers": [
    { "no": 1, "who": "${project.characters[0].id}", "phrase": "おはよう", "expression": "にっこり笑顔", "pose": "ベッドから起き上がり右手を上げて手を振る", "framing": "上半身", "angle": "斜め", "props": "ふとん・朝日", "textPlacement": "上", "textStyle": "丸ゴシックのポップ体・オレンジ→黄色のグラデ・こげ茶の内フチ＋太い白の外フチ・文字の上半分にツヤ", "motion": "${project.kind === 'animation' ? '布団から勢いよく飛び起きて大ジャンプ、両手を振り回して着地' : ''}"${project.kind === 'animation' ? ', "textMotion": "跳ねる", "charMotion": "ジャンプ"' : ''} }
  ]
}
- expression / pose / props は絵師がそのまま描ける具体的な日本語で。**pose は「どこで・何を・どう動いているか」が浮かぶ 1 場面として 25〜60 文字で書く**（短い「手を振る、上半身」は NG）。
  - 悪い例: pose「お辞儀、全身」props「」 → 単調で状況が伝わらない
  - 良い例: pose「ちゃぶ台の前に座り、湯気の立つお茶とおまんじゅうをこちらに差し出す」framing「全身」angle「見下ろし」props「ちゃぶ台・湯のみ・おまんじゅう・湯気」
  - 良い例: pose「開いたドアから半身を出し、手招きしている」framing「上半身」angle「斜め」props「木のドア・玄関マット・差し込む光」
  - 良い例: pose「ふとんで丸くなって眠り、ぬいぐるみを抱く」framing「引き」angle「見下ろし」props「ふとん・枕・月と星・Zzz」
  - 良い例: pose「画面から飛び出すように身を乗り出し、こちらに手を伸ばす」framing「顔アップ」angle「見上げ」props「ノート PC の画面フチ・効果線」
  - 小物・場面の文字（看板やマットの文字など）は入れない。文字はセリフだけ。
- framing は "顔アップ" / "上半身" / "全身" / "引き" のどれか。angle は "正面" / "斜め" / "横" / "後ろ" / "見上げ" / "見下ろし" のどれか。
- textPlacement は "上" / "下" / "左上" / "右上" / "なし" のどれか（phrase が空なら "なし"）。
- **textStyle（セリフの文字デザイン）は必須**（phrase が空なら空文字）。黒一色の文字は単調なので NG。セリフの内容と気持ちに合わせて、1 個ずつ「書体・配色・飾り」を決める。
  - 書体の例: 元気・お祝い → 極太の丸ゴシックのポップ体 / 了解・承知 → きりっとした筆文字や極太ゴシック / やさしい・ありがとう → 丸みのある手書き風 / びっくり・怒り → ギザギザのマンガ文字 / 眠い・脱力 → ゆるい手書き
  - 配色の例: グラデーション（オレンジ→黄、水色→青、黄緑→緑、赤→オレンジ など）や文字ごとの色分け。セリフの気持ちの色にする（感謝=暖色、了解=青系、元気=黄・オレンジ、癒し=緑・水色）
  - 飾りの例: 色付きの内フチ＋太い白の外フチの二重フチ、ツヤ（ハイライト）、立体的な影、文字の角に小さな星・ハート
  - **全スタンプ共通で「いちばん外側は太い白フチ」**にする（どの背景でも読めるように）。ピンク・マゼンタ・紫は背景の抜き色と近いので使わない（赤・オレンジ・黄・緑・水色・青・こげ茶・黒などを使う）
  - セット全体で同じ配色が続かないようにする
- motion は ${project.kind === 'animation' ? '必須' : '空文字でよい'}。${project.kind === 'animation' ? `
- textMotion（セリフの文字の動き。文字は 1 文字ずつ順に動く）も必須（phrase が空なら空文字）。キャラの動きと気持ちに合わせて「跳ねる / ぐっと拡大 / 波のように揺れる / ぶるぶる震える / くるっと回転 / ポンポン出てくる / びよーんと伸びる」から選ぶ。セット内で同じ動きばかりにしない。
- charMotion（キャラ全体をツールが動かす大きな動き）も必須。motion に合わせて「ジャンプ / ぴょんぴょん / ズーム（手前に飛び出す） / 左右に揺れる / ぶるぶる震える / なし」から選ぶ。8 個なら最低 3 種類は使い、「なし」は 1 個まで。` : ''}
`;
}

/** 2. 画像: 指定したスタンプを 1 枚ずつ image_gen で描く（マゼンタ背景・正方形） */
function imagesPrompt(project, stickers, rawDir) {
  const s = spec(project.kind);
  const p = project.plan || {};
  const isEmoji = project.kind === 'emoji';
  const isBig = project.kind === 'big';
  const isMessage = project.kind === 'message';
  const size = isBig ? '1024x1536（縦長）' : '1024x1024（正方形）';
  const list = stickers.map((st) => {
    const who = whoLabel(project, st.who);
    const textApart = project.kind === 'animation' && st.phrase;
    const text = textApart ? `**文字は入れない**（セリフはツールが別の文字画像から合成する。${st.textPlacement || '上'}側に文字が乗る余白を少し空ける）`
      : st.phrase ? `セリフ「${st.phrase}」を ${st.textPlacement || '上'} に大きく入れる${st.textStyle ? `（文字デザイン: ${st.textStyle}）` : '（カラフルな装飾文字・外側に太い白フチ）'}` : '文字は入れない';
    const extra = isMessage ? '（文字を入れる空白＝空の吹き出しや看板を大きく残す。phrase の例文は描かない）' : '';
    const motionNote = project.kind === 'animation' && st.motion ? `／この絵は動きの 1 コマ目（決めポーズ）: ${st.motion}` : '';
    const fix = st.instruction ? `／**作り直しの指示（最優先）**: ${st.instruction}` : '';
    const textLine = textApart ? `\n- text_${z2(st.no)}.png : セリフ「${st.phrase}」だけの文字画像（文字デザイン: ${st.textStyle || 'セリフの気持ちに合う書体とカラフルな配色'}。下の「文字画像のルール」どおり）` : '';
    return `- raw_${z2(st.no)}.png : 登場=${who} / 表情=${st.expression} / ポーズ=${st.pose}${st.framing ? ' / 構図=' + st.framing : ''}${st.angle ? ' / 向き=' + st.angle : ''}${st.props ? ' / 小物・場面=' + st.props : ''} / ${isEmoji ? '文字なし・顔アップ中心' : text}${extra}${motionNote}${fix}${textLine}`;
  }).join('\n');
  const textRules = stickers.some((st) => project.kind === 'animation' && st.phrase) ? `
## 文字画像（text_NN.png）のルール
- キャラ・小物・効果は描かない。**セリフの文字だけ**を 1024x1024・背景 ${KEY_BG} に描く。
- 文字は指定どおり **一字一句そのまま**。書体・配色・飾りは各スタンプの「文字デザイン」どおりにする（黒一色の単調な文字は NG）。グラデーションや文字ごとの色分け、色付きの内フチ、ツヤ（ハイライト）、立体的な影を使ってカラフルに装飾する。
- **いちばん外側は太い白フチ**（全スタンプ共通）。影や飾りもその白フチの内側に収め、文字の外に離れた飾り（浮いている星・線・吹き出し・下線）は描かない（ツールが 1 文字ずつ切り分けるため。飾りは文字に重ねてくっつける）。
- ピンク・マゼンタ・紫は背景の抜き色に近いので使わない。
- **1 文字ずつ切り離して動かすため、文字と文字の間をはっきり空ける**（字間は文字幅の 2〜3 割。白フチ同士も触れさせない）。文字を大きく斜めに傾けた斜体にしない（隣の文字の上に食い込んで切り分けられない。勢いは太さ・配色・飾りで出す）。
- 横書き。8 文字以下は 1 行、9 文字以上は意味の切れ目で 2 行（行の間もはっきり空ける）。画像の横幅いっぱいに大きく、傾けない・アーチにしない。
` : '';
  return `あなたは LINE スタンプのイラストレーターです。内蔵の **image_gen ツール** で、下の一覧のスタンプ画像を **1 枚ずつ** 生成し、指定のファイル名で ${rawDir} に保存してください。

## キャラクター（必ず参照画像のとおりに描く）
${charBlock(project, idsOfStickers(project, stickers))}
参照画像は cwd に ${charsOf(project, idsOfStickers(project, stickers)).map((c) => c.ref).join(' と ')} として置いてある（添付もしている）。顔・髪型・配色・衣装・装飾・頭身・線の太さを全スタンプで厳密に揃える。別人にしない、リデザインしない、他のキャラを足さない。各スタンプには「登場」に書いたキャラだけを描く。${project.characters.length > 2 ? '参照画像が複数あるので、描くキャラの参照画像を取り違えない（キャラ同士の特徴を混ぜない）。' : ''}

## 絵のルール（絶対）
- サイズ ${size}。**背景は ${KEY_BG}**。ツールがこの色だけを透明にするため、背景に他の色を置くと抜けない。
- 画風: ${p.style || '太めの輪郭線に明るいアニメ塗り、はっきりした配色'}。全スタンプで統一。${isEmoji ? '輪郭を太く濃く、小さく表示されても分かる大きな表情。' : ''}
- 絵は中央に大きく。周囲に少しだけ余白（ツール側で枠に合わせて縮小する）。${isBig ? '縦長を生かし、全身を大きく。' : ''}
- **構図・向きは一覧の指定どおりに描く**。参照画像の「正面向きの立ちポーズ」をなぞらない（参照画像は見た目を揃えるためだけに使う）。顔アップならしっかり寄る、横向き・後ろ姿・見上げ・見下ろしはカメラ位置から変える。
- **豊かに描く**: 指定の小物・場面要素（机・ソファ・ふとん・花・紙吹雪など）はキャラの周りにしっかり描き、汗・効果線・キラキラ・ハート等のマンガ記号も積極的に使って状況と気持ちが一目で伝わるようにする。ただし背景を一面塗りつぶさない（背景色は必ず残す）。写実にしない。ロゴ・透かし・署名・URL を入れない。
- **文字の描き方**: セリフは指定の文字を **一字一句そのまま**、スタンプの中でも読める大きさに。黒一色の単調な文字にしない。各スタンプの「文字デザイン」（書体・配色・飾り）どおりに、カラフルで装飾のある文字にする（グラデーションや色分け、色付きの内フチ＋いちばん外側に太い白フチ、ツヤや立体影）。ピンク・マゼンタ・紫は背景の抜き色に近いので文字に使わない。誤字・架空の文字・崩れた字は NG。文字はキャラの顔に重ねない。
- 1 スタンプ 1 枚。失敗したら、そのスタンプだけプロンプトを簡潔にして 1 回やり直す。既にあるファイルは飛ばしてよい。
- すべて保存したら、保存したファイル名を 1 行ずつ出力して終了する。説明文は不要。

${textRules}
## スタンプ一覧（ファイル名 : 内容）
${list}
`;
}

/** 2b. 1 枚だけ作り直す（指示付き） */
function regenPrompt(project, st, rawDir, instruction) {
  const base = imagesPrompt(project, [st], rawDir);
  return base + `
## 作り直しの指示（最優先）
前回の絵は不採用になった。次の指摘を必ず反映して描き直す: ${instruction || '前回と構図を変えて、より分かりやすく'}
`;
}

/** 3. アニメのコマ: 決めポーズ（raw）を 1 コマ目として、残りのコマを描く */
function framesPrompt(project, st, rawFile, frameCount, framesDir) {
  const prefix = `frame_${z2(st.no)}_`;
  const lines = [];
  for (let i = 2; i <= frameCount; i++) lines.push(`- ${prefix}${z2(i)}.png : ${frameCount} コマ中 ${i} コマ目`);
  return `あなたはアニメーションスタンプの作画担当です。cwd の \`${rawFile}\`（添付もしている）が **1 コマ目（決めポーズ）** です。これと同じキャラ・同じ画風・同じ大きさ・同じ位置で、動きの続きのコマを内蔵の **image_gen ツール** で描き、指定のファイル名で ${framesDir} に保存してください。

## キャラクター
${charBlock(project, whoIds(project, st.who))}

## 動き
「${st.motion || 'その場で弾むように動く'}」を ${frameCount} コマで表現する。最後のコマから 1 コマ目に戻っても自然につながるループにする。
- 1 コマ目は既にある（${rawFile}）。描くのは 2 コマ目〜${frameCount} コマ目。
- **動きは大きく、ダイナミックに**。その場でゆらゆら・少し傾くだけの小さな変化は NG。コマごとにポーズをはっきり変える（腕を大きく振り上げる・体をひねる・深く沈む・伸び上がる・小物を投げる/差し出す）。
- アニメの基本を使う: 動く前の「ため」（体を縮める）→ 勢いよく動く（体を伸ばす・効果線）→ 決めの瞬間（いちばん大きいポーズ、表情もいちばん強く）→ 余韻 → 1 コマ目に戻る。
- 効果・小物も動かす: 汗・ハート・キラキラ・紙吹雪・音符・効果線・湯気などをコマごとに飛ばす、増やす、弾けさせる。
- 表情もコマで変える（目をつぶる → ぱっと開く、口の形を変える等）。
- コマごとに **必ず絵が変わる**。同じ絵の複製は禁止。
- キャラの大きさ（頭身・顔の大きさ）は全コマで同じ。ツールがキャラ全体のジャンプ・ズームを後から付けるので、絵の中でキャラを画面の端まで動かしたり、カメラをズームしたりはしない（体の動きはその場で大きく）。
- 背景は 1 コマ目と同じ ${KEY_BG}。
- 文字は描かない（セリフはツールが後から 1 文字ずつ動かして合成する）。1 コマ目に文字が無ければ全コマ文字なし。
- サイズは 1 コマ目と同じ。ロゴ・透かしなし。

## 出力ファイル
${lines.join('\n')}

すべて保存したら、保存したファイル名を 1 行ずつ出力して終了する。説明文は不要。
`;
}

/** 4. 点検: 生成画像を見て、文字崩れ・キャラ崩れを JSON で報告する */
function checkPrompt(project, stickers, outPath) {
  const list = stickers.map((st) => st.textOnly
    ? `- ${st.rawName} : 文字だけの画像。期待する文字「${st.phrase}」（キャラは描かれていなくてよい＝charOk は true。文字同士が離れているか、黒一色の単調な文字でなくカラフルに装飾されているか、いちばん外側が白フチか、文字から離れて浮いた飾りが無いかも見る。どれかダメなら textOk を false にして issue に直し方を書く）`
    : `- ${st.rawName} : 期待する文字「${st.phrase || '（文字なし）'}」/ 登場=${whoLabel(project, st.who)} / 表情=${st.expression}`).join('\n');
  return `あなたは LINE スタンプの検品担当です。添付した画像（cwd の work/ 以下にも同じファイルがある）を 1 枚ずつ見て、次を判定し、**JSON だけ**を ${outPath} に書いてください。

## キャラクター（参照画像: ${charsOf(project, idsOfStickers(project, stickers)).map((c) => c.ref).join(', ')}）
${charBlock(project, idsOfStickers(project, stickers))}

## 判定項目（各画像）
- textOk: 期待する文字が一字一句正しく、読める大きさで描かれているか（文字なし指定なら、文字が入っていなければ true）
- charOk: 参照キャラと同一人物に見えるか（顔・髪・配色・衣装・頭身。手や指の破綻、腕の本数違いも NG）
- bgOk: 背景がマゼンタ 1 色で、キャラの外側に他の色や模様が無いか
- issue: 問題があれば日本語で短く（作り直しの指示に使う）。無ければ空文字

## 画像一覧
${list}

## JSON の形式
{ "results": [ { "file": "raw_01.png", "textOk": true, "charOk": true, "bgOk": true, "issue": "" } ] }
`;
}

/** 企画のバラエティ点検（機械判定）。問題があれば日本語の指摘リスト、無ければ [] */
function varietyIssues(project, plan) {
  if (project.kind === 'emoji' || !plan || !plan.stickers.length) return [];
  const st = plan.stickers, n = st.length, out = [];
  const count = (f) => st.filter(f).length;
  const front = count((x) => !x.angle || x.angle === '正面');
  if (front > Math.ceil(n * 0.4)) out.push(`正面向き（または向き未指定）が ${front}/${n} 個。正面は 4 割までにし、斜め・横・後ろ・見上げ・見下ろしに散らす`);
  const fr = {}; st.forEach((x) => { const k = x.framing || '未指定'; fr[k] = (fr[k] || 0) + 1; });
  const top = Object.entries(fr).sort((a, b) => b[1] - a[1])[0];
  if (top && (top[0] === '未指定' || top[1] > Math.ceil(n * 0.5))) out.push(`構図が「${top[0]}」に偏っている（${top[1]}/${n} 個）。顔アップ・上半身・全身・引きを散らす`);
  const noProps = count((x) => !x.props);
  if (noProps > Math.floor(n * 0.3)) out.push(`小物・場面要素が無いスタンプが ${noProps}/${n} 個。7 割以上に、セリフに合った小物や場面要素を入れる`);
  const thin = count((x) => (x.pose || '').length < 15);
  if (thin > Math.floor(n * 0.3)) out.push(`ポーズの説明が短すぎるものが ${thin}/${n} 個。「どこで・何を・どう動いているか」が浮かぶ 25〜60 文字の場面にする`);
  if (project.characters.length > 2) {
    const per = Math.max(1, Math.floor(n / project.characters.length));
    const cnt = {}; project.characters.forEach((c) => { cnt[c.id] = 0; });
    st.forEach((x) => whoIds(project, x.who).forEach((id) => { cnt[id]++; }));
    const few = project.characters.filter((c) => cnt[c.id] < per);
    if (few.length) out.push(`登場が少ないキャラがいる（${few.map((c) => `${c.name}=${cnt[c.id]} 回`).join('、')}）。全キャラ最低 ${per} 回登場させる（多いキャラの回を振り替える。who を変えたらセリフ・ポーズもそのキャラらしく直す）`);
    const many = project.characters.filter((c) => cnt[c.id] > per + 2);
    if (many.length) out.push(`登場が多すぎるキャラがいる（${many.map((c) => `${c.name}=${cnt[c.id]} 回`).join('、')}）。1 人 ${per + 2} 回までにする`);
  }
  for (let i = 2; i < n; i++) {
    const k = (x) => (x.framing || '') + '|' + (x.angle || '');
    if (k(st[i]) === k(st[i - 1]) && k(st[i]) === k(st[i - 2])) { out.push(`${z2(st[i - 2].no)}〜${z2(st[i].no)} が同じ構図・向きで 3 個続いている`); break; }
  }
  return out;
}

/** 5. 企画の手直し（指示付きで JSON を更新） */
function replanPrompt(project, instruction, outPath) {
  return `下の JSON は LINE スタンプセットの企画です。依頼主の指示に沿って手直しし、同じ形式の **JSON だけ**を ${outPath} に書き出してください。
指示に関係ない部分（番号・既に決まっているセリフ）は変えない。個数は ${project.count} 個のまま。

## 依頼主の指示
${instruction}

## キャラクター
${charBlock(project)}

## 現在の企画 JSON
${JSON.stringify(project.plan, null, 2)}
`;
}

module.exports = { varietyIssues, planPrompt, imagesPrompt, regenPrompt, framesPrompt, checkPrompt, replanPrompt, whoLabel, whoIds, idsOfStickers };
