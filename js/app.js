/* LINEスタンプメーカー — 画面側（依存なし） */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(url, opts) { return fetch(url, opts).then(function (r) { return r.json(); }); }
  function postJSON(url, body) { return api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }); }
  function del(url) { return api(url, { method: 'DELETE' }); }
  function fmtDate(t) { var d = new Date(t); return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function z2(n) { return String(n).padStart(2, '0'); }

  // ---------- ライセンス ----------
  var license = { mode: 'free' };
  function isFree() { return license.mode !== 'member' && license.mode !== 'full'; }
  function loadLicense() {
    return api('/api/license').then(function (d) {
      license = d;
      var b = $('license-banner');
      b.textContent = d.message || '';
      b.classList.toggle('member', !isFree());
      b.classList.toggle('hidden', !d.message);
      $('activate-panel').classList.toggle('hidden', !isFree());
      $('free-credit').textContent = isFree() ? (d.freeCredit || '') : '';
      renderKinds();
    }).catch(function () {});
  }
  $('activate-btn').addEventListener('click', function () {
    var email = ($('activate-email').value || '').trim();
    if (!email) return;
    var msg = $('activate-msg');
    msg.textContent = '認証中…'; msg.classList.remove('hidden');
    postJSON('/api/activate', { email: email }).then(function (d) {
      msg.textContent = d.message || (d.activated ? '認証しました' : '認証できませんでした');
      if (d.activated) loadLicense();
    });
  });

  // ---------- タブ ----------
  var views = ['make', 'list', 'detail', 'chars', 'settings'];
  function showView(name) {
    views.forEach(function (v) { $('view-' + v).classList.toggle('hidden', v !== name); });
    document.querySelectorAll('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.view === name || (name === 'detail' && t.dataset.view === 'list')); });
    if (name === 'list') loadSets();
    if (name === 'chars') loadChars();
    if (name === 'settings') loadConfig();
    if (name !== 'detail') currentSet = null;
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.tab').forEach(function (t) { t.addEventListener('click', function () { showView(t.dataset.view); }); });
  $('btn-back').addEventListener('click', function () { showView('list'); });

  // ---------- 設定・環境 ----------
  var specs = {}, config = {}, characters = [], textLimits = { title: 40, description: 160 };
  function loadConfig() {
    return api('/api/config').then(function (d) {
      config = d.config || {};
      specs = d.specs || {};
      characters = d.characters || [];
      textLimits = d.textLimits || textLimits;
      $('s-datadir').value = config.dataDir || '';
      $('s-creator').value = config.creatorName || '';
      $('s-copyright').value = config.copyright || '';
      $('s-workurl').value = config.workUrl || '';
      $('s-reviewnote').value = config.reviewNote || '';
      $('s-batch').value = config.batchSize || '5';
      $('s-parallel').value = config.parallel || '2';
      $('s-check').value = config.checkImages || '1';
      $('s-model').value = config.codexModel || '';
      $('config-path').textContent = d.configPath || '';
      renderEnv(d.env || {});
      renderKinds();
      renderCharPick();
      $('spec-list').innerHTML = Object.keys(specs).map(function (k) {
        var s = specs[k];
        return '<li><b>' + esc(s.label) + '</b>: ' + esc(s.counts.join(' / ')) + ' 個、' + s.size.w + 'x' + s.size.h + 'px 以内' + (s.animated ? '、APNG 5〜20 コマ・最大 4 秒' : '') + '。' + esc(s.hint) + '</li>';
      }).join('') + '<li><b>共通</b>: メイン画像 240x240、タブ画像 96x74、PNG 透過、偶数サイズ、1 個 1MB 以下。タイトル 40 文字・説明文 160 文字（全角は 2 文字換算）。</li>';
    });
  }
  function renderEnv(env) {
    var rows = [['codex CLI（企画・画像生成・点検に必須）', env.codex, 'brew install codex のあと codex login してください（Windows: npm i -g @openai/codex）。0.150 以上が必要です']];
    $('env-check').innerHTML = rows.map(function (r) {
      return '<div class="env-row"><span class="' + (r[1] ? 'ok' : 'ng') + '">' + (r[1] ? '○' : '×') + '</span><span>' + esc(r[0]) + (r[1] ? '' : '<br><span class="note">' + esc(r[2]) + '</span>') + '</span></div>';
    }).join('');
    var warn = $('env-warning');
    if (!env.codex) { warn.textContent = 'codex CLI が見つかりません。生成には codex（ChatGPT サブスク）が必要です。設定タブの環境チェックを確認してください。'; warn.classList.remove('hidden'); }
    else warn.classList.add('hidden');
  }
  $('btn-save-settings').addEventListener('click', function () {
    postJSON('/api/config', { dataDir: $('s-datadir').value, creatorName: $('s-creator').value, copyright: $('s-copyright').value, workUrl: $('s-workurl').value, reviewNote: $('s-reviewnote').value, batchSize: $('s-batch').value, parallel: $('s-parallel').value, checkImages: $('s-check').value, codexModel: $('s-model').value })
      .then(function (d) { $('settings-msg').textContent = d.ok ? '保存しました。' : (d.error || '保存に失敗しました'); if (d.ok) { config = d.config; renderEnv(d.env || {}); } });
  });
  $('btn-open-data').addEventListener('click', function () { postJSON('/api/open-data-dir'); });
  $('btn-open-data-list').addEventListener('click', function () { postJSON('/api/open-data-dir'); });

  // ---------- キャラクター ----------
  var picked = [];
  function charCard(c, on, withDelete) {
    return '<div class="char-card' + (on ? ' on' : '') + '" data-id="' + esc(c.id) + '">' +
      '<img src="' + esc(c.image) + '" alt="">' +
      '<span class="cn">' + esc(c.name) + '</span>' +
      '<span class="cd">' + esc(c.description) + '</span>' +
      (withDelete ? (c.bundled ? '<span class="tag">同梱</span>' : '<button type="button" class="ghost small danger del-char" data-id="' + esc(c.id) + '">削除</button>') : '') +
      '</div>';
  }
  function renderCharPick() {
    var box = $('char-pick');
    box.innerHTML = characters.map(function (c) { return charCard(c, picked.indexOf(c.id) >= 0, false); }).join('');
    box.querySelectorAll('.char-card').forEach(function (el) {
      el.addEventListener('click', function () {
        var id = el.dataset.id, i = picked.indexOf(id);
        if (i >= 0) picked.splice(i, 1); else { if (picked.length >= 20) picked.shift(); picked.push(id); }
        renderCharPick();
      });
    });
  }
  function loadChars() {
    return api('/api/characters').then(function (d) {
      characters = d.characters || [];
      var box = $('char-list');
      box.innerHTML = characters.map(function (c) { return charCard(c, false, true); }).join('') || '<p class="note">まだありません。</p>';
      box.querySelectorAll('.del-char').forEach(function (b) {
        b.addEventListener('click', function (e) { e.stopPropagation(); if (!confirm('このキャラクターを削除しますか？')) return; del('/api/characters/' + encodeURIComponent(b.dataset.id)).then(loadChars); });
      });
      renderCharPick();
    });
  }
  $('btn-add-char').addEventListener('click', function () {
    var body = { name: $('c-name').value, imagePath: $('c-image').value, description: $('c-desc').value, speech: $('c-speech').value };
    $('char-msg').textContent = '追加中…';
    postJSON('/api/characters', body).then(function (d) {
      $('char-msg').textContent = d.ok ? '追加しました。' : (d.error || '追加できませんでした');
      if (d.ok) { $('c-name').value = ''; $('c-image').value = ''; $('c-desc').value = ''; $('c-speech').value = ''; loadChars(); }
    });
  });

  // ---------- 種類 ----------
  var kind = 'static';
  function renderKinds() {
    var box = $('kind-grid');
    if (!Object.keys(specs).length) return;
    box.innerHTML = Object.keys(specs).map(function (k) {
      var s = specs[k];
      var member = isFree() && k !== 'static';
      return '<button type="button" class="kind' + (k === kind ? ' active' : '') + '" data-kind="' + k + '"><span class="kn">' + esc(s.label) + (member ? '<span class="member-tag">会員</span>' : '') + '</span><span class="kd">' + esc(s.counts.join('/')) + ' 個・' + s.size.w + 'x' + s.size.h + '</span></button>';
    }).join('');
    box.querySelectorAll('.kind').forEach(function (b) { b.addEventListener('click', function () { kind = b.dataset.kind; renderKinds(); }); });
    var s = specs[kind];
    var sel = $('f-count'), cur = sel.value;
    sel.innerHTML = s.counts.map(function (n) { return '<option value="' + n + '"' + (isFree() && n > 8 ? ' disabled' : '') + '>' + n + ' 個' + (n === (kind === 'animation' ? 16 : 32) ? '（おすすめ）' : '') + '</option>'; }).join('');
    sel.value = s.counts.indexOf(parseInt(cur, 10)) >= 0 ? cur : (isFree() ? '8' : String(kind === 'animation' ? 16 : kind === 'emoji' ? 24 : 32));
    $('kind-hint').textContent = s.hint;
    $('f-frames-wrap').classList.toggle('hidden', !s.animated);
    $('f-textmode').disabled = kind === 'emoji';
  }

  // ---------- 作る ----------
  $('btn-submit').addEventListener('click', function () {
    if (!picked.length) { alert('キャラクターを選んでください。'); return; }
    var auto = $('f-auto').value === 'auto';
    var body = {
      kind: kind, count: parseInt($('f-count').value, 10), characterIds: picked, auto: auto,
      brief: { title: $('f-title').value, theme: $('f-theme').value, audience: $('f-audience').value, tone: $('f-tone').value, phrases: $('f-phrases').value, notes: $('f-notes').value, textMode: $('f-textmode').value, frames: $('f-frames').value },
    };
    var btn = $('btn-submit'); btn.disabled = true;
    postJSON('/api/create', body).then(function (d) {
      if (d.error) { alert(d.error); return; }
      $('submit-note').textContent = auto ? '受け付けました。企画 2〜3 分、画像は 1 個 1〜2 分（アニメはさらに 3〜5 分）。完成すると「セットの一覧」に ZIP が付きます。画面を閉じても続きます。' : '受け付けました。2〜3 分で企画（セリフ一覧）ができます。「セットの一覧」から開いて確認し、「描き始める」を押してください。';
      pollJobs();
    }).finally(function () { btn.disabled = false; });
  });
  $('f-auto').addEventListener('change', function () { $('btn-submit').textContent = $('f-auto').value === 'auto' ? '一気に作る' : '企画を作る'; });

  // ---------- ジョブ ----------
  var jobTimer = null, lastJobsJSON = '';
  function renderJobs(jobs) {
    var box = $('jobs');
    if (!jobs.length) { box.innerHTML = '<p class="note">まだ処理はありません。</p>'; return; }
    box.innerHTML = jobs.slice(0, 8).map(function (j) {
      return '<div class="job' + (j.stage === 'error' ? ' error' : '') + '"><div class="jl">' + esc(j.label) + '</div><div class="js">' + esc(j.stageLabel) + (j.detail ? ' — ' + esc(j.detail) : '') + '</div>' +
        (j.error ? '<div class="je">' + esc(j.error) + '</div>' : '') + '<div class="bar"><i style="width:' + (j.progress || 0) + '%"></i></div></div>';
    }).join('');
  }
  function pollJobs() {
    api('/api/jobs').then(function (d) {
      var jobs = d.jobs || [];
      var s = JSON.stringify(jobs.map(function (j) { return [j.id, j.stage, j.progress, j.detail]; }));
      if (s !== lastJobsJSON) {
        lastJobsJSON = s; renderJobs(jobs);
        if (currentSet) openSet(currentSet, true);
        if (!$('view-list').classList.contains('hidden')) loadSets();
      }
      var active = jobs.some(function (j) { j.stage !== 'done' && j.stage !== 'error'; return j.stage !== 'done' && j.stage !== 'error'; });
      clearTimeout(jobTimer);
      jobTimer = setTimeout(pollJobs, active ? 3000 : 15000);
    }).catch(function () { clearTimeout(jobTimer); jobTimer = setTimeout(pollJobs, 10000); });
  }

  // ---------- 一覧 ----------
  function loadSets() {
    return api('/api/sets').then(function (d) {
      var sets = d.sets || [];
      var box = $('set-list');
      if (!sets.length) { box.innerHTML = '<p class="note">まだセットがありません。「作る」タブから始めてください。</p>'; return; }
      box.innerHTML = sets.map(function (s) {
        var thumb = s.done ? '/files/' + encodeURIComponent(s.id) + '/stickers/' + z2(s.mainNo || 1) + '.png?t=' + s.updatedAt : '';
        var badge = s.status === 'done' ? 'done' : s.status === 'error' ? 'error' : s.status === 'running' ? 'running' : '';
        return '<div class="set" data-id="' + esc(s.id) + '">' +
          '<img src="' + esc(thumb) + '" alt="" onerror="this.style.visibility=\'hidden\'">' +
          '<div><div class="st">' + esc(s.title) + '<span class="badge ' + badge + '">' + esc(s.statusLabel) + '</span></div>' +
          '<div class="sm">' + esc(s.kindLabel) + ' ' + s.count + ' 個（完成 ' + s.done + '）・' + esc(s.characters.join('・')) + '・' + fmtDate(s.createdAt) + '</div></div>' +
          '<div class="sa"><button type="button" class="ghost small open-set" data-id="' + esc(s.id) + '">開く</button> <button type="button" class="ghost small danger del-set" data-id="' + esc(s.id) + '">削除</button></div></div>';
      }).join('');
      box.querySelectorAll('.open-set').forEach(function (b) { b.addEventListener('click', function () { openSet(b.dataset.id); }); });
      box.querySelectorAll('.del-set').forEach(function (b) { b.addEventListener('click', function () { if (!confirm('このセットを削除しますか？（画像も消えます）')) return; del('/api/sets/' + encodeURIComponent(b.dataset.id)).then(loadSets); }); });
    });
  }
  $('btn-reload-list').addEventListener('click', loadSets);

  // ---------- 詳細 ----------
  var currentSet = null, selectedNo = null, editingPlan = false;
  function openSet(id, silent) {
    currentSet = id;
    api('/api/sets/' + encodeURIComponent(id)).then(function (p) {
      if (p.error) { alert(p.error); return; }
      if (editingPlan && silent) return; // 編集中は上書きしない
      renderDetail(p);
      if (!silent) showView('detail');
    });
  }
  function fileUrl(p, rel) { return '/files/' + encodeURIComponent(p.id) + '/' + rel + '?t=' + p.updatedAt; }
  function renderDetail(p) {
    var plan = p.plan;
    var isBig = p.kind === 'big';
    var html = '';
    var badge = p.status === 'done' ? 'done' : p.status === 'error' ? 'error' : p.status === 'running' ? 'running' : '';
    html += '<section class="card"><div class="row-between"><h2>' + esc(plan ? plan.title : p.title) + '<span class="badge ' + badge + '">' + esc(p.statusLabel) + '</span></h2>' +
      '<div><button type="button" class="ghost small" id="d-open">保存フォルダを開く</button></div></div>';
    html += '<div class="meta-grid"><div><b>種類</b> ' + esc(p.kindLabel) + ' ' + p.count + ' 個</div><div><b>キャラ</b> ' + esc(p.characters.map(function (c) { return c.name; }).join('・')) + '</div><div><b>作成</b> ' + fmtDate(p.createdAt) + '</div></div>';
    if (p.error) html += '<div class="problems" style="margin-top:0.8rem">' + esc(p.error) + '</div>';
    if (plan) {
      html += '<p style="margin:0.8rem 0 0"><b>コンセプト:</b> ' + esc(plan.concept) + '</p><p style="margin:0.3rem 0 0"><b>説明文:</b> ' + esc(plan.description) + '</p>';
    }
    html += '</section>';

    if (!plan) {
      html += p.status === 'running'
        ? '<section class="card"><p class="note">企画を作成中です。しばらくお待ちください。</p></section>'
        : '<section class="card"><p class="note">企画を作れませんでした。時間を置いてからやり直してください。</p><button type="button" class="primary small" id="d-generate">企画からやり直す</button></section>';
      $('detail').innerHTML = html; bindDetail(p); return;
    }

    // 書き出し
    if (p.outputs && p.outputs.zip) {
      var probs = p.outputs.problems || [];
      html += '<section class="card"><h2>書き出し（LINE Creators Market にそのままアップロードできる ZIP）</h2>' +
        '<div class="preview-row">' +
        (p.outputs.main ? '<figure><img src="' + fileUrl(p, 'export/main.png') + '" width="120" height="120" alt=""><figcaption>main.png 240x240</figcaption></figure>' : '') +
        '<figure><img src="' + fileUrl(p, 'export/tab.png') + '" width="96" height="74" alt=""><figcaption>tab.png 96x74</figcaption></figure>' +
        '<div><a class="ghost" style="display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;padding:.6rem 1.2rem;border:1px solid var(--line);border-radius:999px;color:var(--green-deep)" href="' + fileUrl(p, p.outputs.zip) + '"><svg class="ic"><use href="#i-download"/></svg>ZIP をダウンロード</a>' +
        ' <a class="ghost" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:.4rem;text-decoration:none;padding:.6rem 1.2rem;border:1px solid var(--line);border-radius:999px;color:var(--green-deep)" href="' + fileUrl(p, 'export/line-autofill.html') + '">LINE に一括入力</a>' +
        '<p class="note">' + p.outputs.files + ' ファイル・' + Math.round(p.outputs.totalBytes / 1024) + ' KB。申請メモは export/README.md。「LINE に一括入力」のボタンをブックマークバーへドラッグし、LINE Creators Market の新規登録ページで押すと登録情報がまとめて入ります。</p></div></div>' +
        (probs.length ? '<div class="problems" style="margin-top:0.8rem">要確認: ' + esc(probs.join(' / ')) + '</div>' : '<div class="ok-box" style="margin-top:0.8rem">仕様チェック: 問題なし（サイズ・偶数・1MB・コマ数）</div>') +
        '</section>';
    }

    // スタンプ一覧（画像）
    html += '<section class="card"><div class="row-between"><h2>スタンプ（クリックで選択 → 下で修正）</h2><div>' +
      (p.status !== 'running' ? '<button type="button" class="primary small" id="d-generate">' + (p.stickers.some(function (s) { return s.status === 'done'; }) ? '未完成の分を描く' : '描き始める') + '</button> ' : '') +
      (p.stickers.some(function (s) { return s.status === 'done'; }) && p.status !== 'running' ? '<button type="button" class="ghost small" id="d-export">ZIP を作り直す</button>' : '') +
      '</div></div><div class="sticker-grid">';
    plan.stickers.forEach(function (ps) {
      var st = p.stickers.find(function (x) { return x.no === ps.no; }) || { status: 'pending' };
      var img = st.status === 'done' || st.status === 'drawn' ? fileUrl(p, 'stickers/' + z2(ps.no) + '.png') : (st.raw ? fileUrl(p, st.raw) : '');
      html += '<div class="sticker' + (isBig ? ' big' : '') + (st.status === 'done' ? '' : ' pending') + (selectedNo === ps.no ? ' sel' : '') + '" data-no="' + ps.no + '">' +
        '<span class="no">' + z2(ps.no) + '</span>' + (plan.mainNo === ps.no ? '<span class="mark">メイン</span>' : plan.tabNo === ps.no ? '<span class="mark">タブ</span>' : '') +
        (img ? '<img src="' + img + '" alt="">' : '<div style="aspect-ratio:37/32;background:var(--paper);border-radius:8px"></div>') +
        '<div class="ph">' + esc(ps.phrase || '（文字なし）') + '</div>' +
        (st.issue && st.status !== 'done' ? '<div class="ng">' + esc(st.issue) + '</div>' : '') +
        (st.status === 'pending' ? '<div class="ng" style="color:var(--muted)">未生成</div>' : '') +
        '</div>';
    });
    html += '</div>';

    // 1 個の修正パネル
    if (selectedNo) {
      var ps = plan.stickers.find(function (x) { return x.no === selectedNo; }) || {};
      var whoOpts = p.characters.map(function (c) { return '<option value="' + esc(c.id) + '"' + (ps.who === c.id ? ' selected' : '') + '>' + esc(c.name) + '</option>'; }).join('') + (p.characters.length === 2 ? '<option value="both"' + (ps.who === 'both' ? ' selected' : '') + '>両方</option>' : '')
        + (p.characters.length > 2 && String(ps.who || '').indexOf('+') > 0 ? '<option value="' + esc(ps.who) + '" selected>' + esc(String(ps.who).split('+').map(function (id) { var c = p.characters.find(function (x) { return x.id === id; }); return c ? c.name : id; }).join('と')) + '</option>' : '');
      html += '<div class="edit-panel"><h3>' + z2(selectedNo) + ' を直す</h3><div class="form-grid">' +
        '<div class="field"><label>セリフ</label><input type="text" id="e-phrase" value="' + esc(ps.phrase) + '"' + (p.kind === 'emoji' ? ' disabled' : '') + '></div>' +
        '<div class="field"><label>登場</label><select id="e-who">' + whoOpts + '</select></div>' +
        '<div class="field"><label>表情</label><input type="text" id="e-expression" value="' + esc(ps.expression) + '"></div>' +
        '<div class="field"><label>ポーズ（場面）</label><input type="text" id="e-pose" value="' + esc(ps.pose) + '"></div>' +
        '<div class="field"><label>構図（顔アップ / 上半身 / 全身 / 引き）</label><input type="text" id="e-framing" value="' + esc(ps.framing || '') + '"></div>' +
        '<div class="field"><label>向き（正面 / 斜め / 横 / 後ろ / 見上げ / 見下ろし）</label><input type="text" id="e-angle" value="' + esc(ps.angle || '') + '"></div>' +
        '<div class="field"><label>小物</label><input type="text" id="e-props" value="' + esc(ps.props) + '"></div>' +
        (specs[p.kind] && specs[p.kind].animated ? '<div class="field"><label>動き</label><input type="text" id="e-motion" value="' + esc(ps.motion) + '"></div>' : '') +
        '<div class="field wide"><label>作り直しの指示（任意。例: 文字をもっと大きく / 顔をもっと笑顔に / 背景の色が残っている）</label><input type="text" id="e-instruction" placeholder="前回の絵のどこを直すか"></div>' +
        '</div><div class="actions">' +
        (p.status !== 'running' ? '<button type="button" class="primary" id="e-regen">この 1 個を作り直す</button>' : '<span class="note">処理中は作り直せません。終わるまでお待ちください。</span>') +
        '<button type="button" class="ghost" id="e-main">メイン画像にする</button><button type="button" class="ghost" id="e-tab">タブ画像にする</button>' +
        '<button type="button" class="ghost" id="e-close">閉じる</button></div></div>';
    }
    html += '</section>';

    // 企画の表（全体編集）
    html += '<section class="card"><div class="row-between"><h2>企画（セリフ一覧）</h2><div>' +
      '<button type="button" class="ghost small" id="d-edit-plan">' + (editingPlan ? '編集をやめる' : '表で編集する') + '</button></div></div>';
    if (editingPlan) {
      html += '<div class="form-grid" style="margin-bottom:0.8rem"><div class="field"><label>タイトル（' + textLimits.title + ' 文字以内・全角 2 換算）</label><input type="text" id="pl-title" value="' + esc(plan.title) + '"></div><div class="field"><label>メイン / タブ</label><div style="display:flex;gap:.5rem"><input type="text" id="pl-main" value="' + plan.mainNo + '" style="width:5rem"><input type="text" id="pl-tab" value="' + plan.tabNo + '" style="width:5rem"></div></div><div class="field wide"><label>説明文（' + textLimits.description + ' 文字以内）</label><textarea id="pl-desc" rows="2">' + esc(plan.description) + '</textarea></div></div>';
      html += '<table class="plan-table"><thead><tr><th>#</th><th>セリフ</th><th>表情</th><th>ポーズ</th><th>構図</th><th>向き</th><th>小物</th>' + (specs[p.kind] && specs[p.kind].animated ? '<th>動き</th>' : '') + '</tr></thead><tbody>';
      plan.stickers.forEach(function (ps) {
        html += '<tr data-no="' + ps.no + '"><td class="n">' + z2(ps.no) + '</td><td><input data-k="phrase" value="' + esc(ps.phrase) + '"></td><td><input data-k="expression" value="' + esc(ps.expression) + '"></td><td><input data-k="pose" value="' + esc(ps.pose) + '"></td><td><input data-k="framing" value="' + esc(ps.framing || '') + '"></td><td><input data-k="angle" value="' + esc(ps.angle || '') + '"></td><td><input data-k="props" value="' + esc(ps.props) + '"></td>' + (specs[p.kind] && specs[p.kind].animated ? '<td><input data-k="motion" value="' + esc(ps.motion) + '"></td>' : '') + '</tr>';
      });
      html += '</tbody></table><div class="actions"><button type="button" class="primary" id="pl-save">企画を保存</button><span class="note">変えたスタンプは未生成に戻り、「未完成の分を描く」で描き直せます。</span></div>';
    } else {
      html += '<table class="plan-table"><thead><tr><th>#</th><th>セリフ</th><th>表情</th><th>ポーズ</th><th>構図</th><th>向き</th><th>小物</th>' + (specs[p.kind] && specs[p.kind].animated ? '<th>動き</th>' : '') + '</tr></thead><tbody>';
      plan.stickers.forEach(function (ps) {
        html += '<tr><td class="n">' + z2(ps.no) + '</td><td>' + esc(ps.phrase || '（文字なし）') + '</td><td>' + esc(ps.expression) + '</td><td>' + esc(ps.pose) + '</td><td>' + esc(ps.framing || '') + '</td><td>' + esc(ps.angle || '') + '</td><td>' + esc(ps.props) + '</td>' + (specs[p.kind] && specs[p.kind].animated ? '<td>' + esc(ps.motion) + '</td>' : '') + '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '<h3>AI に企画を手直しさせる</h3><div class="activate-row"><input type="text" id="pl-instruction" placeholder="例）仕事で使える返事を増やして / もっと短いセリフに / 2 人の掛け合いを増やして"><button type="button" class="ghost" id="pl-replan">手直しする</button></div>';
    html += '</section>';

    $('detail').innerHTML = html;
    bindDetail(p);
  }
  function bindDetail(p) {
    var id = p.id;
    var on = function (elId, fn) { var el = $(elId); if (el) el.addEventListener('click', fn); };
    on('d-open', function () { postJSON('/api/sets/' + encodeURIComponent(id) + '/open'); });
    on('d-generate', function () { postJSON('/api/sets/' + encodeURIComponent(id) + '/generate').then(function (d) { if (d.error) alert(d.error); else { pollJobs(); openSet(id, true); } }); });
    on('d-export', function () { postJSON('/api/sets/' + encodeURIComponent(id) + '/export').then(function (d) { if (d.error) alert(d.error); openSet(id, true); }); });
    document.querySelectorAll('#detail .sticker').forEach(function (el) {
      el.addEventListener('click', function () { selectedNo = parseInt(el.dataset.no, 10); renderDetail(p); var ep = document.querySelector('.edit-panel'); if (ep) ep.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
    });
    on('e-close', function () { selectedNo = null; renderDetail(p); });
    on('e-regen', function () {
      var patch = { phrase: ($('e-phrase').value || '').trim(), who: $('e-who').value, expression: $('e-expression').value, pose: $('e-pose').value, framing: $('e-framing').value, angle: $('e-angle').value, props: $('e-props').value };
      if ($('e-motion')) patch.motion = $('e-motion').value;
      postJSON('/api/sets/' + encodeURIComponent(id) + '/stickers/' + selectedNo + '/regen', { instruction: $('e-instruction').value, patch: patch })
        .then(function (d) { if (d.error) alert(d.error); else { pollJobs(); openSet(id, true); } });
    });
    on('e-main', function () { postJSON('/api/sets/' + encodeURIComponent(id) + '/plan', { mainNo: selectedNo }).then(function () { openSet(id, true); }); });
    on('e-tab', function () { postJSON('/api/sets/' + encodeURIComponent(id) + '/plan', { tabNo: selectedNo }).then(function () { openSet(id, true); }); });
    on('d-edit-plan', function () { editingPlan = !editingPlan; renderDetail(p); });
    on('pl-save', function () {
      var stickers = Array.prototype.map.call(document.querySelectorAll('#detail .plan-table tbody tr'), function (tr) {
        var o = { no: parseInt(tr.dataset.no, 10) };
        tr.querySelectorAll('input').forEach(function (i) { o[i.dataset.k] = i.value; });
        var orig = p.plan.stickers.find(function (x) { return x.no === o.no; }) || {};
        return Object.assign({}, orig, o);
      });
      var body = { title: $('pl-title').value, description: $('pl-desc').value, mainNo: parseInt($('pl-main').value, 10), tabNo: parseInt($('pl-tab').value, 10), stickers: stickers };
      postJSON('/api/sets/' + encodeURIComponent(id) + '/plan', body).then(function (d) { if (d.error) alert(d.error); editingPlan = false; openSet(id, true); });
    });
    on('pl-replan', function () {
      var ins = ($('pl-instruction').value || '').trim();
      if (!ins) { alert('手直しの指示を入れてください。'); return; }
      postJSON('/api/sets/' + encodeURIComponent(id) + '/replan', { instruction: ins }).then(function (d) { if (d.error) alert(d.error); else { pollJobs(); openSet(id, true); } });
    });
  }

  // ---------- 起動 ----------
  loadLicense().then(loadConfig).then(function () { pollJobs(); });
})();
