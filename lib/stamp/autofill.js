// LINE Creators Market「新規登録」ページへの一括入力（ブックマークレット）。Node 標準のみ。
// LINE には登録用の公開 API が無いので、本人が自分のブラウザで開いている登録ページ上でこのスクリプトを実行し、
// 画面のラベル文字列（「タイトル English」「コピーライト」など）を手がかりに欄を探して値を入れる。
// ログイン・画像アップロード・審査リクエストは自動化しない（本人の操作の範囲内。KindleMaker の KDP 自動入力と同じ考え方）。
'use strict';
const { spec } = require('./specs.js');

/** 種類 → 登録画面の「スタンプのタイプ」の選択肢 */
const TYPE_LABEL = { static: 'スタンプ', animation: 'アニメーションスタンプ', big: 'BIGスタンプ', message: 'メッセージスタンプ' };

function autofillData(cfg, project) {
  const p = project.plan || {};
  return {
    type: TYPE_LABEL[project.kind] || '',
    titleEn: p.titleEn || '',
    descriptionEn: p.descriptionEn || '',
    titleJa: p.title || project.title || '',
    descriptionJa: p.description || '',
    copyright: cfg.copyright || '',
    // セットごとの指定（plan.workUrl / plan.reviewNote）を優先。別キャラのセットに既定のキャラ説明が入らないように
    workUrl: p.workUrl || cfg.workUrl || '',
    reviewNote: p.reviewNote || cfg.reviewNote || '',
    usesAi: true,
  };
}

/** ブラウザで実行するスクリプト本文（data を埋め込む） */
function buildScript(data) {
  return `(function(){
var D=${JSON.stringify(data)};
var ok=[],ng=[];
function sp(s){return String(s||"").replace(/\\s+/g,"");}
function vis(e){return !!(e&&e.offsetParent!==null);}
function setV(el,v){var pr=el.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:el.tagName==="SELECT"?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(pr,"value").set.call(el,String(v));["input","change","keyup","blur"].forEach(function(t){el.dispatchEvent(new Event(t,{bubbles:true}));});}
function labelOf(r){var l=r.closest("label")||(r.id&&document.querySelector('label[for="'+r.id+'"]'));var t=l?sp(l.textContent):"";var n=r.nextSibling;while(!t&&n){t=sp(n.textContent);n=n.nextSibling;}return t;}
function radio(test){var r=Array.from(document.querySelectorAll("input[type=radio]")).find(function(x){return test(labelOf(x));});if(!r)return false;if(!r.checked)r.click();return true;}
/* ラベルの文字を含むいちばん内側の要素から親をたどり、入力欄を持つ最初の箱の中の欄を返す */
function field(test,sel){
  var c=Array.from(document.querySelectorAll("th,td,dt,dd,label,span,div,p,li")).filter(function(e){var t=sp(e.textContent);return t.length<40&&test(t);});
  c=c.filter(function(e){return !c.some(function(o){return o!==e&&e.contains(o);});});
  for(var i=0;i<c.length;i++){var a=c[i];for(var k=0;k<8&&a;k++){var f=Array.from(a.querySelectorAll(sel)).filter(vis);if(f.length)return f[0];a=a.parentElement;}}
  return null;
}
function put(name,test,sel,v){if(!v){ng.push(name+"（値が空）");return;}var f=field(test,sel);if(f){setV(f,v);ok.push(name);}else ng.push(name);}
var TXT="input[type=text],input:not([type])";
function lang(code){
  var t=new RegExp(code==="ja"?"日本語|Japanese":"English");
  put("タイトル（"+(code==="ja"?"日本語":"英語")+"）",function(s){return /タイトル/.test(s)&&t.test(s);},TXT,code==="ja"?D.titleJa:D.titleEn);
  put("説明文（"+(code==="ja"?"日本語":"英語")+"）",function(s){return /説明文/.test(s)&&t.test(s);},"textarea",code==="ja"?D.descriptionJa:D.descriptionEn);
}
function hasJa(){return !!field(function(s){return /タイトル/.test(s)&&/日本語|Japanese/.test(s);},TXT);}
function addJa(){
  var s=Array.from(document.querySelectorAll("select")).find(function(x){return Array.from(x.options).some(function(o){return /日本語|Japanese/.test(o.textContent);});});
  if(!s)return false;
  var o=Array.from(s.options).find(function(o){return /日本語|Japanese/.test(o.textContent);});
  setV(s,o.value);
  var box=s.parentElement,b=null;for(var k=0;k<4&&box&&!b;k++){b=Array.from(box.querySelectorAll("button,input[type=button],a")).find(function(x){return /追加/.test(x.textContent||x.value||"");});box=box.parentElement;}
  if(b){b.click();return true;}return false;
}
function rest(){
  lang("en");
  if(!hasJa()){if(!addJa())ng.push("言語に日本語を追加");}
  setTimeout(function(){
    if(hasJa())lang("ja");else ng.push("タイトル・説明文（日本語）");
    put("コピーライト",function(s){return /^.?コピーライト/.test(s);},TXT,D.copyright);
    if(D.workUrl)put("作品が確認できるURL",function(s){return /^.?作品が確認できるURL/.test(s);},"input[type=url],"+TXT,D.workUrl);
    if(D.reviewNote)put("その他、補足事項",function(s){return /^.?その他.?補足事項/.test(s);},"textarea",D.reviewNote);
    if(D.usesAi){if(radio(function(t){return /^AIを使用しています/.test(t);}))ok.push("AIの使用: 使用しています");else ng.push("AIの使用");}
    alert("LINEスタンプ一括入力\\n\\n入れた: "+(ok.join(" / ")||"なし")+"\\n\\n入らなかった（手で入れてください）: "+(ng.join(" / ")||"なし")+"\\n\\nクリエイター名・テイストカテゴリ・販売情報は画面で選んでください。最後に内容を確認して「保存」を押してください。");
  },1200);
}
if(!/creator\\.line\\.me/.test(location.host)){alert("LINE Creators Market の「新規登録」ページで押してください。");return;}
if(D.type){if(radio(function(t){return t===D.type;}))ok.push("タイプ: "+D.type);else ng.push("スタンプのタイプ");}
setTimeout(rest,600);
})();`;
}

function esc(s) { return String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

/** ブックマークレットを置いた案内ページ（export/line-autofill.html） */
function buildPage(cfg, project) {
  const d = autofillData(cfg, project);
  const href = 'javascript:' + encodeURIComponent(buildScript(d));
  const rows = [
    ['スタンプのタイプ', d.type], ['タイトル（英語）', d.titleEn], ['説明文（英語）', d.descriptionEn],
    ['タイトル（日本語）', d.titleJa], ['説明文（日本語）', d.descriptionJa], ['コピーライト', d.copyright || '（未設定: 設定タブで登録すると入ります）'], ['AIの使用', 'AIを使用しています'],
    ['作品が確認できるURL', d.workUrl || '（未設定・空欄で可）'], ['その他、補足事項', d.reviewNote || '（未設定・空欄で可）'],
  ];
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>LINE一括入力 - ${esc(d.titleJa)}</title>
<style>
html{font-size:17px}
body{margin:0;background:#f6faf6;color:#1d2a1f;font-family:"Hiragino Sans","Noto Sans JP",sans-serif;line-height:1.85;letter-spacing:.04em}
main{max-width:760px;margin:0 auto;padding:2rem 1rem 4rem}
h1{font-size:1.6rem;margin:0 0 .4rem}
h2{font-size:1.2rem;margin:2.2rem 0 .8rem}
.bm{display:inline-block;margin:1rem 0;padding:.9rem 1.6rem;border-radius:999px;background:#06c755;color:#fff;font-weight:700;text-decoration:none;font-size:1.1rem;cursor:grab}
ol{padding-left:1.4rem}li{margin:.4rem 0}
table{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden}
th,td{padding:.7rem .9rem;border-bottom:1px solid #e3ece4;text-align:left;vertical-align:top}
th{width:9.5rem;font-weight:600;color:#3d5a42;font-size:.95rem}
button{font:inherit;font-size:.85rem;margin-left:.5rem;padding:.15rem .7rem;border:1px solid #b9d3bd;border-radius:999px;background:#fff;cursor:pointer}
.note{color:#4f6353;font-size:.95rem}
</style></head><body><main>
<h1>LINE Creators Market 一括入力</h1>
<p class="note">${esc(d.titleJa)}（${esc(spec(project.kind).label)}・${project.count} 個）</p>
<h2>使い方</h2>
<ol>
<li>下の緑のボタンを、ブラウザのブックマークバーへドラッグして登録する（セットごとに 1 回）</li>
<li>LINE Creators Market のマイページで「新規登録」を開く</li>
<li>登録したブックマークを押す。タイプ・英語と日本語のタイトルと説明文・コピーライト・AIの使用・作品URL・補足事項がまとめて入る</li>
<li>クリエイター名・テイストカテゴリ・販売情報を画面で選び、内容を確認して「保存」</li>
<li>保存後の編集画面で、スタンプ画像の ZIP（export フォルダの ZIP）をアップロードする</li>
</ol>
<a class="bm" href="${esc(href)}" onclick="alert('このボタンはブックマークバーへドラッグして使います。LINE の新規登録ページで押してください。');return false;">LINE入力: ${esc(d.titleJa)}</a>
<h2>入る内容（手で入れる時はコピー）</h2>
<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td><span>${esc(v)}</span>${v ? '<button type="button" onclick="navigator.clipboard.writeText(this.previousElementSibling.textContent);this.textContent=\'コピーしました\'">コピー</button>' : ''}</td></tr>`).join('')}</table>
</main></body></html>
`;
}

module.exports = { autofillData, buildScript, buildPage, TYPE_LABEL };
