/*
 * スロットデータ収集ブックマークレット(読みやすい版)
 * 店舗WiFi接続中に athink.jp のデータサイト上で実行すると、
 * スロット全機種の全台を自動巡回して BB/RB/確率/大当り履歴を取得し、
 * その場で高設定候補ランキングを表示する。
 * ブックマーク登録は loader.bookmarklet.txt (実行のたびに本ファイルの最新版を読む)。
 *
 * 機能:
 *  - ジャグラー(スペック登録機種): 設定1〜6のベイズ事後確率で高設定確率を表示
 *  - AT機など: 連チャンを一塊にした初当り確率を同機種内で比較(z値)
 *  - ヒント貼付: 晒屋のXポストを貼ると解読し、該当台を実データと突き合わせ
 *  - GAS未設定でも動作(結果JSONをコピーして持ち帰れる)
 */
(async function () {
  if (window.__slotCollectorRunning) { alert('収集は既に実行中です'); return; }
  window.__slotCollectorRunning = true;

  var TENPO = 'angyou';
  var THROTTLE_MS = 200;
  // 設定別ボーナス確率 [BB分母, RB分母] × 設定1〜6(公表値)
  var SPECS = {
    'SマイジャグラーVKD': [[273.1, 409.6], [270.8, 385.5], [266.4, 336.1], [254.0, 290.0], [240.1, 268.6], [229.1, 229.1]],
    'Sゴーゴージャグラー3KA': [[259.0, 354.2], [256.0, 332.7], [249.2, 306.2], [246.5, 278.7], [242.7, 247.3], [234.9, 234.9]],
    'SネオアイムジャグラーEX-KK': [[273.1, 439.8], [271.2, 399.6], [269.7, 331.0], [266.4, 315.1], [263.2, 292.6], [268.6, 268.6]]
  };
  var MIN_GAMES_RANK = 800;

  // ヒント解読用: ポスト内キーワード → 機種名に含まれる文字列
  var HINT_ALIASES = [
    [/GOD|ゴッド/i, 'ミリオンゴッド'],
    [/カバネリ/, 'カバネリ'],
    [/マイジャグ/, 'マイジャグラー'],
    [/ゴージャグ|ゴーゴージャグ/, 'ゴーゴージャグラー'],
    [/アイムジャグ|ネオアイム/, 'アイムジャグラー'],
    [/ファンキー/, 'ファンキージャグラー'],
    [/ハッピージャグ/, 'ハッピージャグラー'],
    [/ミスタージャグ/, 'ミスタージャグラー'],
    [/ウルミラ|ウルトラミラクル/, 'ウルトラミラクルジャグラー'],
    [/北斗/, '北斗'],
    [/ヴァルヴレイヴ|ヴヴヴ/, 'ヴァルヴレイヴ'],
    [/喰種|グール/, '喰種'],
    [/モンキーターン/, 'モンキーターン'],
    [/からくり/, 'からくりサーカス'],
    [/バジリスク|絆/, 'バジリスク'],
    [/沖ドキ/, '沖ドキ'],
    [/吉宗|ヨシムネ/, '吉宗'],
    [/番長/, '番長'],
    [/乙女/, '乙女'],
    [/モンハン|モンスターハンター/, 'モンスターハンター'],
    [/カイジ/, 'カイジ'],
    [/化物語/, '化物語'],
    [/マギレコ|マギアレコード/, 'マギアレコード'],
    [/とある/, 'とある'],
    [/ディスクアップ|DISCUP/i, 'DISCUP'],
    [/ストファイ|ストリートファイター|スト6/, 'ストリートファイター'],
    [/ハナビ|花火/, 'ハナビ'],
    [/チバリヨ/, 'チバリヨ'],
    [/ヤバチバ/, 'ヤバチバ'],
    [/南国/, '南国育ち'],
    [/秘宝伝/, '秘宝伝'],
    [/鏡|サラリーマン/, '鏡'],
    [/かぐや/, 'かぐや様'],
    [/リオ/, 'リオエース'],
    [/東リベ|リベンジャーズ/, 'リベンジャーズ'],
    [/SAO|ソードアート/i, 'ソードアート'],
    [/ビッグドリーム/, 'ビッグドリーム'],
    [/戦コレ|戦国コレクション/, '戦国コレクション'],
    [/鬼武者/, '鬼武者']
  ];
  // メーカー名 → 該当機種キーワード(この店の設置機種ベース、要追加)
  var HINT_MAKERS = {
    'Sammy|サミー': ['北斗', 'カバネリ', 'DISCUP', 'ストリートファイター', 'ディスクアップ'],
    '北電子': ['ジャグラー'],
    'ユニバ|ユニバーサル': ['ミリオンゴッド', '沖ドキ', 'バジリスク', 'ハナビ', 'クランキー', 'バーサス', 'SHAMANKING'],
    '大都': ['吉宗', 'ヨシムネ', '番長', '秘宝伝']
  };

  var filterStr = localStorage.getItem('slot_kishu_filter') || '';
  var KISHU_FILTER = new RegExp(filterStr);

  var gasUrl = localStorage.getItem('slot_gas_url') || '';
  if (!gasUrl) {
    gasUrl = prompt('GAS WebアプリのURL(未デプロイなら空欄のままOK→コピー画面になります)', '') || '';
    if (gasUrl) localStorage.setItem('slot_gas_url', gasUrl);
  }

  var aborted = false;
  var lastMachines = null;
  var lastScores = null;

  // AT機の設定別スペック(すろらぼ由来)を先読みしておく
  var atspecsPromise = fetch('https://raw.githubusercontent.com/iga89koshi-art/slot-app/main/collect/atspecs.json', { cache: 'no-store' })
    .then(function (r) { return r.ok ? r.json() : {}; })
    .catch(function () { return {}; });

  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.92);color:#0f0;font:12px/1.5 monospace;padding:10px;overflow:auto;';
  var topBar = document.createElement('div');
  topBar.style.cssText = 'position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;';
  var hintBtn = document.createElement('button');
  hintBtn.textContent = 'ヒント貼付';
  hintBtn.style.cssText = 'padding:10px 14px;font-size:14px;background:#63c;color:#fff;border:0;border-radius:6px;';
  var setBtn = document.createElement('button');
  setBtn.textContent = '設定';
  setBtn.style.cssText = 'padding:10px 14px;font-size:14px;background:#835;color:#fff;border:0;border-radius:6px;';
  setBtn.onclick = function () {
    var cur = localStorage.getItem('slot_gh_token') ? '登録済み' : '未登録';
    var t = prompt('サイト自動アップ用のGitHubトークン(現在: ' + cur + ')。貼り付けて OK。空欄でOKなら変更なし、「clear」で削除', '');
    if (t === null) return;
    t = t.trim();
    if (t === 'clear') {
      localStorage.removeItem('slot_gh_token');
      logStrong('トークンを削除しました', '#f9c');
    } else if (t) {
      localStorage.setItem('slot_gh_token', t);
      logStrong('トークンを保存しました。接続テスト中...', '#6f6');
      ghApi('/contents/data/index.json', 'GET', null, t).then(function () {
        logStrong('✅ 接続テストOK(トークン有効・API疎通あり)。次の収集からアップされます', '#6f6');
      }, function (err) {
        logStrong('⚠ 接続テスト失敗: ' + err.message + ' (401ならトークン設定ミス、Load failedならこの回線がGitHub APIを塞いでいる可能性)', '#f66');
      });
    }
  };
  var stopBtn = document.createElement('button');
  stopBtn.textContent = '中止/閉じる';
  stopBtn.style.cssText = 'padding:10px 14px;font-size:14px;background:#c33;color:#fff;border:0;border-radius:6px;';
  stopBtn.onclick = function () { aborted = true; box.remove(); window.__slotCollectorRunning = false; };
  var logDiv = document.createElement('div');
  topBar.appendChild(setBtn);
  topBar.appendChild(hintBtn);
  topBar.appendChild(stopBtn);
  box.appendChild(topBar);
  box.appendChild(logDiv);
  document.body.appendChild(box);

  function log(msg) {
    var p = document.createElement('div');
    p.textContent = msg;
    logDiv.appendChild(p);
  }
  function logStrong(msg, color) {
    var p = document.createElement('div');
    p.textContent = msg;
    p.style.cssText = 'color:' + (color || '#ff0') + ';font-weight:bold;';
    logDiv.appendChild(p);
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function parseHtml(s) { return new DOMParser().parseFromString(s, 'text/html'); }
  async function fetchDoc(url) {
    var res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
    return parseHtml(await res.text());
  }
  function toInt(s) {
    var m = String(s || '').replace(/[^0-9\-]/g, '');
    return m === '' ? null : parseInt(m, 10);
  }
  function toDen(s) {
    var m = String(s || '').match(/1\s*\/\s*(\d+)/);
    return m ? parseInt(m[1], 10) : null;
  }
  function today() {
    var el = document.getElementById('kishu_list_target_date');
    if (el && el.value) return el.value;
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  function parseCounters(doc) {
    var out = {};
    doc.querySelectorAll('#data_counter_s li, #data_counter_p li').forEach(function (li) {
      var labelEl = li.querySelector('.normalWhiteText');
      var ov = li.querySelector('.overrideText');
      if (!labelEl || !ov) return;
      var label = labelEl.textContent.trim();
      var val = '';
      ov.querySelectorAll('span').forEach(function (sp) {
        if (sp.classList.contains('shadowOpacity1') || sp.classList.contains('shadowOpacity2')) return;
        val += sp.textContent;
      });
      if (label) out[label] = val.trim();
    });
    return out;
  }

  function parseHistory(doc) {
    var rows = [];
    doc.querySelectorAll('#oatari_rireki tbody tr').forEach(function (tr) {
      var td = tr.querySelectorAll('td');
      if (td.length < 5) return;
      rows.push({
        no: toInt(td[0].textContent),
        start: toInt(td[1].textContent),
        dedama: toInt(td[2].textContent),
        type: td[3].textContent.trim(),
        time: td[4].textContent.trim()
      });
    });
    return rows;
  }

  function showJsonCopy(payload) {
    var ta = document.createElement('textarea');
    ta.value = payload;
    ta.readOnly = true;
    ta.style.cssText = 'width:100%;height:40vh;font-size:11px;background:#111;color:#0f0;border:1px solid #0f0;';
    var btn = document.createElement('button');
    btn.textContent = '収集結果JSONをコピー(約' + Math.round(payload.length / 1024) + 'KB)';
    btn.style.cssText = 'display:block;width:100%;padding:14px;font-size:15px;background:#2b6;color:#fff;border:0;border-radius:6px;margin:8px 0;';
    btn.onclick = function () {
      ta.select();
      ta.setSelectionRange(0, payload.length);
      var done = function () { btn.textContent = 'コピーしました!メモやGoogleドキュメントに貼ってください'; };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(done, function () { document.execCommand('copy'); done(); });
      } else { document.execCommand('copy'); done(); }
    };
    logDiv.appendChild(btn);
    logDiv.appendChild(ta);
  }

  // ---- 分析 ----

  function posterior56(m, spec) {
    var n = m.totalStart;
    var lls = spec.map(function (st) {
      var pb = 1 / st[0], pr = 1 / st[1];
      return m.bb * Math.log(pb) + (n - m.bb) * Math.log(1 - pb) +
             m.rb * Math.log(pr) + (n - m.rb) * Math.log(1 - pr);
    });
    var mx = Math.max.apply(null, lls);
    var ws = lls.map(function (l) { return Math.exp(l - mx); });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    var p = ws.map(function (w) { return w / sum; });
    return { p56: p[4] + p[5], p456: p[3] + p[4] + p[5] };
  }

  function firstHits(m) {
    // 連チャン(33G以内の当選)を一塊=1初当りとして数える
    if (!m.history || !m.history.length) return (m.bb || 0) + (m.rb || 0);
    var hist = m.history.slice().sort(function (a, b) { return a.no - b.no; });
    var hits = 0;
    hist.forEach(function (h, idx) {
      if (idx === 0 || h.start > 33) hits++;
    });
    return hits;
  }

  // 連チャンを一塊にしたセット一覧(初当りG数・獲得枚数)
  function computeSets(m) {
    if (!m.history || !m.history.length) return [];
    var hist = m.history.slice().sort(function (a, b) { return a.no - b.no; });
    var sets = [];
    hist.forEach(function (h) {
      if (sets.length && h.start <= 33) {
        var s = sets[sets.length - 1];
        s.dedama += (h.dedama || 0);
        s.hits++;
      } else {
        sets.push({ firstStart: h.start, dedama: h.dedama || 0, hits: 1 });
      }
    });
    return sets;
  }

  // 挙動指標: 単発率・平均獲得・早当り(ゾーン)・天井回数
  function extrasText(m, spec) {
    var sets = computeSets(m);
    if (!sets.length) return '';
    var tan = sets.filter(function (s) { return s.hits === 1; }).length;
    var avg = Math.round(sets.reduce(function (a, s) { return a + s.dedama; }, 0) / sets.length);
    var t = ' 単発' + Math.round(100 * tan / sets.length) + '% 平均' + avg + '枚';
    if (spec && spec.fastG) {
      var f = sets.filter(function (s) { return s.firstStart <= spec.fastG; }).length;
      t += ' 早当り' + f + '/' + sets.length;
    }
    if (spec && spec.tenjoG) {
      var tj = sets.filter(function (s) { return s.firstStart >= spec.tenjoG - 64; }).length;
      if (tj) t += ' 天井' + tj + '回';
    }
    return t;
  }

  // 台番 → スコア({kind:'p',p56,p456} または {kind:'z',z,hits,avgDen})
  // AT機スペック(すろらぼ由来)のヘルパー
  // spec.s = {設定番号: [列1の分母, 列2の分母, ...]} 列はCZ確率/AT確率など複数系統
  function atLabels(spec) {
    return Object.keys(spec.s).map(Number).sort(function (a, b) { return a - b; });
  }
  // データサイトの実測初当り(連チャンマージ後)のスケールに最も近い列を選ぶ
  function chooseCol(spec, obsDen) {
    var labels = atLabels(spec);
    var best = 0, bestDiff = Infinity;
    for (var c = 0; c < spec.cols; c++) {
      var sum = 0;
      labels.forEach(function (s) { sum += spec.s[s][c]; });
      var mean = sum / labels.length;
      var diff = Math.abs(Math.log(obsDen) - Math.log(mean));
      if (diff < bestDiff) { bestDiff = diff; best = c; }
    }
    return best;
  }
  function atPosterior(spec, col, k, n) {
    var labels = atLabels(spec);
    var lls = labels.map(function (s) {
      var p = 1 / spec.s[s][col];
      return k * Math.log(p) + (n - k) * Math.log(1 - p);
    });
    var mx = Math.max.apply(null, lls);
    var ws = lls.map(function (l) { return Math.exp(l - mx); });
    var sum = ws.reduce(function (a, b) { return a + b; }, 0);
    var p56 = 0, p456 = 0;
    labels.forEach(function (s, i) {
      var p = ws[i] / sum;
      if (s >= 5) p56 += p;
      if (s >= 4) p456 += p;
    });
    return { p56: p56, p456: p456 };
  }

  function computeScores(machines, atspecs) {
    atspecs = atspecs || {};
    var scores = {};
    machines.forEach(function (m) {
      var spec = SPECS[m.kishuName];
      if (spec && m.totalStart != null && m.totalStart >= MIN_GAMES_RANK && m.bb != null && m.rb != null) {
        var r = posterior56(m, spec);
        scores[m.daiban] = { kind: 'p', p56: r.p56, p456: r.p456 };
      }
    });
    // すろらぼスペックのある機種: 初当り確率のベイズ推定
    var atGroups = {};
    machines.forEach(function (m) {
      if (SPECS[m.kishuName] || !atspecs[m.kishuName]) return;
      if (m.totalStart == null || m.totalStart < MIN_GAMES_RANK) return;
      var hits = firstHits(m);
      if (!hits) return;
      (atGroups[m.kishuName] = atGroups[m.kishuName] || []).push({ m: m, hits: hits });
    });
    var acceptedAt = {};
    Object.keys(atGroups).forEach(function (name) {
      var spec = atspecs[name];
      var g = atGroups[name];
      var sumH = 0, sumG = 0;
      g.forEach(function (x) { sumH += x.hits; sumG += x.m.totalStart; });
      var obsDen = sumG / sumH;
      // 平均獲得が極端に小さい場合はCZ等の小信号を数えているとみなし判定しない
      var dedamaSum = 0, setCnt = 0;
      g.forEach(function (x) {
        computeSets(x.m).forEach(function (st) { dedamaSum += st.dedama; setCnt++; });
      });
      if (setCnt && dedamaSum / setCnt < 40) return;
      var col = chooseCol(spec, obsDen);
      // 安全弁: 実測の初当りスケールがスペックの設定1〜6の範囲から大きく外れる場合は
      // 数え方が合っていない(スペックが直撃系の数値等)とみなし、この機種は判定しない
      var labels = atLabels(spec);
      var dens = labels.map(function (s) { return spec.s[s][col]; });
      var minD = Math.min.apply(null, dens), maxD = Math.max.apply(null, dens);
      if (obsDen < minD / 1.35 || obsDen > maxD * 1.35) return;
      acceptedAt[name] = 1;
      g.forEach(function (x) {
        var r = atPosterior(spec, col, x.hits, x.m.totalStart);
        scores[x.m.daiban] = { kind: 'pa', p56: r.p56, p456: r.p456, hits: x.hits, col: col };
      });
    });
    // スペックが無い/スケール不一致の機種: 同機種内比較(z値)
    var groups = {};
    machines.forEach(function (m) {
      if (SPECS[m.kishuName] || acceptedAt[m.kishuName]) return;
      if (m.totalStart == null || m.totalStart < MIN_GAMES_RANK) return;
      var hits = firstHits(m);
      if (!hits) return;
      (groups[m.kishuNo] = groups[m.kishuNo] || []).push({ m: m, hits: hits });
    });
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.length < 4) return;
      var sumH = 0, sumG = 0;
      g.forEach(function (x) { sumH += x.hits; sumG += x.m.totalStart; });
      var pbar = sumH / sumG;
      g.forEach(function (x) {
        var exp = x.m.totalStart * pbar;
        scores[x.m.daiban] = { kind: 'z', z: (x.hits - exp) / Math.sqrt(exp), hits: x.hits, avgDen: Math.round(1 / pbar) };
      });
    });
    return scores;
  }

  function shortName(m) {
    return m.kishuName.replace(/^(LB|L|S)/, '').slice(0, 12);
  }
  function scoreText(m, s) {
    if (!s) return '';
    if (s.kind === 'p') return ' 高設定' + Math.round(s.p56 * 100) + '%';
    if (s.kind === 'pa') return ' 初当り' + s.hits + '(1/' + Math.round(m.totalStart / s.hits) + ') 高設定' + Math.round(s.p56 * 100) + '%';
    return ' 初当り' + s.hits + '(1/' + Math.round(m.totalStart / s.hits) + ') 機種平均1/' + s.avgDen + ' 優秀度' + (s.z >= 0 ? '+' : '') + s.z.toFixed(1);
  }
  function sortKey(s) {
    if (!s) return -99;
    if (s.kind === 'z') return s.z;
    return s.p56 * 10; // 高設定確率とz値をざっくり同スケール化
  }

  function renderRankings(machines, scores) {
    var jr = machines.filter(function (m) { return scores[m.daiban] && scores[m.daiban].kind === 'p'; })
      .sort(function (a, b) { return scores[b.daiban].p56 - scores[a.daiban].p56; });
    logStrong('== ジャグラー 高設定候補(設5・6確率順 / ' + MIN_GAMES_RANK + 'G以上) ==');
    jr.slice(0, 12).forEach(function (m) {
      var s = scores[m.daiban];
      var mark = s.p56 >= 0.45 ? '★' : (s.p56 >= 0.3 ? '◯' : '　');
      logStrong(mark + ' 台' + m.daiban + ' ' + shortName(m) +
        ' G' + m.totalStart + ' BB' + m.bb + ' RB' + m.rb + ' 合成1/' + (m.gousei || '?') +
        ' 高設定' + Math.round(s.p56 * 100) + '%(設4以上' + Math.round(s.p456 * 100) + '%)',
        s.p56 >= 0.45 ? '#f66' : '#ff0');
    });
    if (!jr.length) logStrong('(対象データなし)');

    var pa = machines.filter(function (m) { return scores[m.daiban] && scores[m.daiban].kind === 'pa'; })
      .sort(function (a, b) { return scores[b.daiban].p56 - scores[a.daiban].p56; });
    logStrong('== AT機 高設定候補(すろらぼ基準・設5以上確率順) ==', '#0cf');
    pa.slice(0, 15).forEach(function (m) {
      var s = scores[m.daiban];
      var mark = s.p56 >= 0.45 ? '★' : (s.p56 >= 0.3 ? '◯' : '　');
      logStrong(mark + ' 台' + m.daiban + ' ' + shortName(m) +
        ' G' + m.totalStart + ' 初当り' + s.hits + '(1/' + Math.round(m.totalStart / s.hits) + ')' +
        ' 高設定' + Math.round(s.p56 * 100) + '%(設4以上' + Math.round(s.p456 * 100) + '%)' +
        extrasText(m, window.__slotAtspecs && window.__slotAtspecs[m.kishuName]),
        s.p56 >= 0.45 ? '#f66' : '#0cf');
    });
    if (!pa.length) logStrong('(対象データなし)', '#0cf');

    var at = machines.filter(function (m) { return scores[m.daiban] && scores[m.daiban].kind === 'z'; })
      .sort(function (a, b) { return scores[b.daiban].z - scores[a.daiban].z; });
    var atTop = at.filter(function (m) { return scores[m.daiban].z >= 1; }).slice(0, 8);
    if (atTop.length) {
      logStrong('== スペック未登録機種 同機種内で初当りが強い台(参考) ==', '#0cf');
      atTop.forEach(function (m) {
        logStrong('　台' + m.daiban + ' ' + shortName(m) + ' G' + m.totalStart + scoreText(m, scores[m.daiban]), '#0cf');
      });
    }
  }

  // ---- ヒント ----

  function parseHintText(text) {
    var h = { daiban: [], suffix: [], kishu: [], note: '' };
    (text.match(/(\d{3,4})番台/g) || []).forEach(function (s) {
      h.daiban.push(parseInt(s, 10));
    });
    var re = /末尾(\d)/g, sm;
    while ((sm = re.exec(text))) h.suffix.push(parseInt(sm[1], 10));
    HINT_ALIASES.forEach(function (a) {
      if (a[0].test(text) && h.kishu.indexOf(a[1]) === -1) h.kishu.push(a[1]);
    });
    Object.keys(HINT_MAKERS).forEach(function (mk) {
      if (new RegExp(mk, 'i').test(text)) {
        HINT_MAKERS[mk].forEach(function (t) {
          if (h.kishu.indexOf(t) === -1) h.kishu.push(t);
        });
      }
    });
    var dm = text.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
    if (dm) h.postDate = ('0' + dm[1]).slice(-2) + '-' + ('0' + dm[2]).slice(-2);
    // 構造パターン: 「8台以上機種に1/2」「3台並び」「全台系/全🌈」
    var pm;
    if ((pm = text.match(/(\d+)台以上[^\n]*1\/2/))) h.half = parseInt(pm[1], 10);
    else if (/1\/2/.test(text)) h.half = 0;
    if ((pm = text.match(/(\d+)台並び/))) h.run = parseInt(pm[1], 10);
    if (/全台系|全🌈|全系|全台/.test(text)) h.zentai = true;
    return h;
  }

  async function getMergedHints(date) {
    var merged = { daiban: [], suffix: [], kishu: [], notes: [], dateWarn: '' };
    var has = false;
    try {
      var hres = await fetch('https://raw.githubusercontent.com/iga89koshi-art/slot-app/main/collect/hints.json', { cache: 'no-store' });
      if (hres.ok) {
        var rh = await hres.json();
        if (rh && rh.date === date) {
          merged.daiban = merged.daiban.concat(rh.daiban || []);
          merged.suffix = merged.suffix.concat(rh.suffix || []);
          merged.kishu = merged.kishu.concat(rh.kishu || []);
          (rh.ranges || []).forEach(function (r) { merged.ranges = (merged.ranges || []).concat([r]); });
          if (rh.half != null) merged.half = rh.half;
          if (rh.run) merged.run = rh.run;
          if (rh.zentai) merged.zentai = true;
          if (rh.note) merged.notes.push(rh.note);
          has = true;
        }
      }
    } catch (e) { }
    try {
      var stored = JSON.parse(localStorage.getItem('slot_hint') || 'null');
      if (stored && stored.date === date && stored.text) {
        var ph = parseHintText(stored.text);
        merged.daiban = merged.daiban.concat(ph.daiban);
        merged.suffix = merged.suffix.concat(ph.suffix);
        merged.kishu = merged.kishu.concat(ph.kishu);
        if (ph.half != null) merged.half = ph.half;
        if (ph.run) merged.run = ph.run;
        if (ph.zentai) merged.zentai = true;
        merged.notes.push('貼付ポスト解読: ' + (ph.kishu.join('/') || 'キーワードなし') +
          (ph.half != null ? ' [1/2配分' + (ph.half ? ':' + ph.half + '台以上機種' : '') + ']' : '') +
          (ph.run ? ' [' + ph.run + '台並び]' : '') + (ph.zentai ? ' [全台系]' : ''));
        if (ph.postDate && date.slice(5) !== ph.postDate) {
          merged.dateWarn = '⚠ポスト内日付(' + ph.postDate + ')が今日と違います';
        }
        has = true;
      }
    } catch (e) { }
    return has ? merged : null;
  }

  function renderHints(machines, scores, hints) {
    logStrong('== 本日のヒント該当台 × 実データ ==', '#f9f');
    hints.notes.forEach(function (n) { logStrong('　' + n, '#f9f'); });
    if (hints.dateWarn) logStrong('　' + hints.dateWarn, '#f66');
    var matched = [];
    machines.forEach(function (m) {
      if (m.totalStart == null) return;
      var reasons = [];
      if (hints.daiban.indexOf(m.daiban) !== -1) reasons.push('指名台');
      if (hints.suffix.indexOf(m.daiban % 10) !== -1) reasons.push('末尾' + (m.daiban % 10));
      hints.kishu.forEach(function (kw) {
        if (m.kishuName.indexOf(kw) !== -1) reasons.push(kw);
      });
      (hints.ranges || []).forEach(function (r) {
        if (m.daiban >= r[0] && m.daiban <= r[1]) reasons.push('島' + r[0] + '-' + r[1]);
      });
      if (reasons.length) matched.push({ m: m, reasons: reasons });
    });
    matched.sort(function (a, b) { return sortKey(scores[b.m.daiban]) - sortKey(scores[a.m.daiban]); });
    logStrong('　該当' + matched.length + '台(挙動が良い順に最大20台表示)', '#f9f');
    matched.slice(0, 20).forEach(function (x) {
      var m = x.m;
      logStrong('　台' + m.daiban + ' ' + shortName(m) + ' G' + m.totalStart +
        ' 合成1/' + (m.gousei || '?') + scoreText(m, scores[m.daiban]) +
        ' [' + x.reasons.join(',') + ']', '#f9f');
    });
  }

  // 好調判定: スペックあり機種は高設定確率40%以上、スペックなしは初当りz値1.0以上
  function isGood(m, scores) {
    var s = scores[m.daiban];
    if (!s) return false;
    if (s.kind === 'z') return s.z >= 1.0;
    return s.p56 >= 0.4;
  }

  // 機種別サマリー: 全台系・1/2配分の検出用
  function renderKishuSummary(machines, scores, hints) {
    var groups = {};
    machines.forEach(function (m) {
      if (m.totalStart == null) return;
      var g = (groups[m.kishuNo + '_' + m.kashitama] = groups[m.kishuNo + '_' + m.kashitama] || { name: m.kishuName, ms: [] });
      g.ms.push(m);
    });
    var rows = [];
    Object.keys(groups).forEach(function (k) {
      var g = groups[k];
      if (g.ms.length < 3) return;
      var good = g.ms.filter(function (m) { return isGood(m, scores); });
      var sumHits = 0, sumG = 0;
      g.ms.forEach(function (m) { sumHits += firstHits(m); sumG += m.totalStart; });
      var spec = SPECS[g.name];
      var atspec = window.__slotAtspecs && window.__slotAtspecs[g.name];
      var pooled = '';
      if (spec) {
        var agg = { bb: 0, rb: 0, totalStart: 0 };
        g.ms.forEach(function (m) { agg.bb += m.bb || 0; agg.rb += m.rb || 0; agg.totalStart += m.totalStart; });
        pooled = ' 機種全体高設定' + Math.round(posterior56(agg, spec).p56 * 100) + '%';
      } else if (atspec && sumHits) {
        var col = chooseCol(atspec, sumG / sumHits);
        pooled = ' 初当り合算1/' + Math.round(sumG / sumHits) +
          ' 機種全体高設定' + Math.round(atPosterior(atspec, col, sumHits, sumG).p56 * 100) + '%';
      } else if (sumHits) {
        pooled = ' 初当り合算1/' + Math.round(sumG / sumHits);
      }
      var ratio = good.length / g.ms.length;
      var marks = [];
      if (ratio >= 0.7 && g.ms.length >= 3) marks.push('★全台系?');
      if (hints && hints.half != null && g.ms.length >= (hints.half || 0) && ratio >= 0.35 && ratio < 0.7) marks.push('☆1/2候補');
      rows.push({
        name: g.name, n: g.ms.length, good: good.length, ratio: ratio, pooled: pooled, marks: marks,
        goodDaiban: good.map(function (m) { return m.daiban; })
      });
    });
    rows.sort(function (a, b) { return b.ratio - a.ratio || b.n - a.n; });
    logStrong('== 機種別サマリー(全台系・1/2配分の検出) ==', '#fa0');
    rows.filter(function (r) { return r.good > 0; }).slice(0, 12).forEach(function (r) {
      logStrong('　' + (r.marks.join('') || '　') + ' ' + r.name.replace(/^(LB|L|S)/, '').slice(0, 14) +
        ' ' + r.n + '台中 好調' + r.good + '台' + r.pooled +
        (r.goodDaiban.length ? ' [' + r.goodDaiban.join(',') + ']' : ''), '#fa0');
    });
  }

  // 並び検出: 隣接台番で好調が連続する箇所と「座り目候補」の提案
  function renderRuns(machines, scores) {
    var byKishu = {};
    machines.forEach(function (m) {
      if (m.totalStart == null) return;
      (byKishu[m.kishuNo + '_' + m.kashitama] = byKishu[m.kishuNo + '_' + m.kashitama] || []).push(m);
    });
    var lines = [];
    Object.keys(byKishu).forEach(function (k) {
      var ms = byKishu[k].sort(function (a, b) { return a.daiban - b.daiban; });
      var byDai = {};
      ms.forEach(function (m) { byDai[m.daiban] = m; });
      // 好調台の連続(並び)
      var run = [];
      function flushRun() {
        if (run.length >= 2) {
          var name = run[0].kishuName.replace(/^(LB|L|S)/, '').slice(0, 12);
          var neighbors = [];
          var lo = run[0].daiban - 1, hi = run[run.length - 1].daiban + 1;
          if (byDai[lo] && !isGood(byDai[lo], scores)) neighbors.push(lo);
          if (byDai[hi] && !isGood(byDai[hi], scores)) neighbors.push(hi);
          lines.push('　並び' + run.length + '台: ' + run.map(function (m) { return m.daiban; }).join('-') + ' ' + name +
            (neighbors.length ? ' → 端の隣 台' + neighbors.join(',台') + ' も座り目候補' : ''));
        }
        run = [];
      }
      ms.forEach(function (m) {
        if (isGood(m, scores)) {
          if (run.length && m.daiban !== run[run.length - 1].daiban + 1) flushRun();
          run.push(m);
        } else {
          flushRun();
        }
      });
      flushRun();
      // 好調2台に挟まれた台(1つ飛ばし)
      ms.forEach(function (m) {
        var a = byDai[m.daiban - 1], b = byDai[m.daiban + 1];
        if (a && b && isGood(a, scores) && isGood(b, scores) && !isGood(m, scores)) {
          lines.push('　挟まれ台: 台' + m.daiban + ' ' + m.kishuName.replace(/^(LB|L|S)/, '').slice(0, 12) +
            ' (両隣' + a.daiban + '/' + b.daiban + 'が好調) → 座り目候補');
        }
      });
    });
    if (lines.length) {
      logStrong('== 並び・座り目候補 ==', '#6f6');
      lines.forEach(function (l) { logStrong(l, '#6f6'); });
    }
  }

  async function refreshHintSection() {
    if (!lastMachines) return;
    var hints = await getMergedHints(today());
    if (hints) {
      renderHints(lastMachines, lastScores, hints);
      renderKishuSummary(lastMachines, lastScores, hints);
    } else {
      logStrong('(今日の日付のヒントがありません)', '#f9f');
    }
  }

  hintBtn.onclick = function () {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:rgba(0,0,0,.95);padding:12px;display:flex;flex-direction:column;gap:8px;';
    var label = document.createElement('div');
    label.textContent = '晒屋のポストを貼り付けてください(今日の分)';
    label.style.cssText = 'color:#fff;font-size:14px;';
    var ta = document.createElement('textarea');
    ta.style.cssText = 'flex:1;width:100%;font-size:14px;background:#111;color:#fff;border:1px solid #666;';
    try {
      var stored = JSON.parse(localStorage.getItem('slot_hint') || 'null');
      if (stored && stored.date === today()) ta.value = stored.text;
    } catch (e) { }
    var save = document.createElement('button');
    save.textContent = '保存して解読';
    save.style.cssText = 'padding:14px;font-size:15px;background:#2b6;color:#fff;border:0;border-radius:6px;';
    var close = document.createElement('button');
    close.textContent = '閉じる';
    close.style.cssText = 'padding:10px;font-size:14px;background:#555;color:#fff;border:0;border-radius:6px;';
    save.onclick = function () {
      localStorage.setItem('slot_hint', JSON.stringify({ date: today(), text: ta.value }));
      modal.remove();
      var ph = parseHintText(ta.value);
      logStrong('ヒント保存: 機種[' + ph.kishu.join('/') + '] 台番[' + ph.daiban.join(',') + '] 末尾[' + ph.suffix.join(',') + ']', '#f9f');
      refreshHintSection();
    };
    close.onclick = function () { modal.remove(); };
    modal.appendChild(label);
    modal.appendChild(ta);
    modal.appendChild(save);
    modal.appendChild(close);
    document.body.appendChild(modal);
  };

  // ---- サイト自動アップ(GitHub contents API) ----

  var GH_REPO = 'iga89koshi-art/slot-app';

  function b64u(str) { return btoa(unescape(encodeURIComponent(str))); }
  function b64d(str) { return decodeURIComponent(escape(atob(String(str).replace(/\n/g, '')))); }

  async function ghApi(path, method, body, token) {
    var res = await fetch('https://api.github.com/repos/' + GH_REPO + path, {
      method: method || 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error('GitHub API ' + res.status);
    return res.json();
  }

  function showTokenSetup() {
    var b = document.createElement('button');
    b.textContent = 'サイト自動アップを設定(GitHubトークン貼付)';
    b.style.cssText = 'display:block;width:100%;padding:12px;font-size:14px;background:#835;color:#fff;border:0;border-radius:6px;margin:8px 0;';
    b.onclick = function () {
      var t = prompt('GitHubのFine-grainedトークンを貼り付けてください(slot-appリポジトリのContents読み書き権限)');
      if (t && t.trim()) {
        localStorage.setItem('slot_gh_token', t.trim());
        b.remove();
        logStrong('トークンを保存しました。次回の収集から自動アップされます', '#6f6');
      }
    };
    logDiv.appendChild(b);
  }

  async function ghUpload(payload, date) {
    var token = localStorage.getItem('slot_gh_token') || '';
    if (!token) { showTokenSetup(); return false; }
    var now = new Date();
    var hhmm = ('0' + now.getHours()).slice(-2) + ('0' + now.getMinutes()).slice(-2);
    var fname = date + '_' + hhmm + '.json';
    log('サイトへ自動アップ中... (' + fname + ')');
    await ghApi('/contents/data/' + fname, 'PUT',
      { message: '収集データ ' + date + ' ' + hhmm, content: b64u(payload) }, token);
    var idx = await ghApi('/contents/data/index.json', 'GET', null, token);
    var list = JSON.parse(b64d(idx.content));
    list.unshift({ file: fname, label: date.slice(5).replace('-', '/') + ' ' + hhmm.slice(0, 2) + ':' + hhmm.slice(2) + '時点' });
    await ghApi('/contents/data/index.json', 'PUT',
      { message: 'データ一覧を更新 ' + fname, content: b64u(JSON.stringify(list, null, 1)), sha: idx.sha }, token);
    logStrong('✅ サイトへアップ完了。閲覧ページに数分で反映されます', '#6f6');
    return true;
  }

  // ---- メイン ----

  try {
    // 自動アップ未設定なら最初に登録ボタンを出す(店外でも設定だけ可能)
    if (!localStorage.getItem('slot_gh_token')) {
      logStrong('サイト自動アップが未設定です。下のボタンでトークンを登録できます(店外でもOK)', '#f9c');
      showTokenSetup();
    }
    var date = today();
    log('== スロットデータ収集開始 ' + date + ' 対象:' + (filterStr ? '/' + filterStr + '/' : '全機種') + (gasUrl ? '' : ' [ローカルモード:GAS送信なし]') + ' ==');

    log('機種一覧を取得中...');
    var kishuDoc = await fetchDoc('./php/back/show/kishu_list.php?tenpo_id=' + TENPO + '&p=l&tkn=');
    var kishus = [];
    var seenKishu = {};
    kishuDoc.querySelectorAll('tr.tr_kishu_list_class').forEach(function (tr) {
      var no = tr.getAttribute('data-kishu-no');
      var kashitama = tr.getAttribute('data-kashitama_id');
      var name = decodeURIComponent(tr.getAttribute('data-kishu_name') || '');
      var key = no + '_' + kashitama;
      if (seenKishu[key]) return;
      seenKishu[key] = 1;
      var isSlot = /s$/.test(kashitama || '');
      if (!isSlot && localStorage.getItem('slot_include_pachi') !== '1') return;
      if (KISHU_FILTER.test(name)) {
        kishus.push({ no: no, kashitama: kashitama, name: name, nameEnc: tr.getAttribute('data-kishu_name') || '' });
      }
    });
    log('対象機種: ' + kishus.length + '件');
    if (!kishus.length) { log('対象機種が見つかりません。フィルタ: ' + filterStr); return; }

    var machines = [];
    for (var i = 0; i < kishus.length; i++) {
      if (aborted) return;
      var k = kishus[i];
      log('[' + (i + 1) + '/' + kishus.length + '] ' + k.name + ' の台一覧を取得中...');

      var daibans = [];
      var seenDai = {};
      var page = 1;
      var maxPage = 1;
      while (page <= maxPage && page <= 30) {
        if (aborted) return;
        var listUrl = './php/back/show/dai_list.self.php?page=' + page +
          '&tab=dai_list&tenpo_id=' + TENPO + '&kishu_no=' + k.no +
          '&target_date=' + date + '&kashitama_id=' + k.kashitama.replace(/_/g, '.') +
          '&kishu_name=' + k.nameEnc + '&p=l&tkn=';
        var listDoc = await fetchDoc(listUrl);
        listDoc.querySelectorAll('.list_dedama').forEach(function (el) {
          var d = el.getAttribute('data-daiban');
          if (d && !seenDai[d]) { seenDai[d] = 1; daibans.push(d); }
        });
        listDoc.querySelectorAll('.pagerclz4dailist,.pagerclz4slump').forEach(function (a) {
          var p = parseInt(a.getAttribute('data-page'), 10);
          if (p && p > maxPage) maxPage = p;
        });
        page++;
        await sleep(THROTTLE_MS);
      }
      log('  台番: ' + daibans.join(','));

      for (var j = 0; j < daibans.length; j++) {
        if (aborted) return;
        var daiban = daibans[j];
        try {
          var dedamaUrl = './php/back/show/dedama.self.php?tenpo_id=' + TENPO +
            '&base_tenpo_id=' + TENPO + '&_date=' + date + '&daiban=' + daiban +
            '&max_y_minus=null&max_y_plus=null&kishu_no=' + k.no +
            '&kashitama_id=' + k.kashitama + '&from_search=0&p=l&tkn=&dai_ext_tkn=';
          var dDoc = await fetchDoc(dedamaUrl);
          var c = parseCounters(dDoc);
          var updM = dDoc.body.textContent.match(/(\d+\/\d+\s+\d+:\d+)\s*更新/);
          machines.push({
            daiban: toInt(daiban),
            kishuNo: toInt(k.no),
            kishuName: k.name,
            kashitama: k.kashitama,
            bb: toInt(c['BB']),
            rb: toInt(c['RB']),
            games: toInt(c['ゲーム数']),
            bbProb: toDen(c['BB確率']),
            rbProb: toDen(c['RB確率']),
            gousei: toDen(c['合成確率']),
            maxDedama: toInt(c['最大持玉']),
            totalStart: toInt(c['累計ｽﾀｰﾄ']),
            updatedAt: updM ? updM[1] : '',
            history: parseHistory(dDoc)
          });
          var last = machines[machines.length - 1];
          if (last.totalStart === null && last.bb === null && !last.history.length) {
            log('  台' + daiban + ' ⚠データが取れていません(構造不一致の可能性)');
          } else {
            log('  台' + daiban + ' BB:' + last.bb + ' RB:' + last.rb + ' 累計:' + last.totalStart + ' 合成:1/' + last.gousei);
          }
        } catch (err) {
          log('  台' + daiban + ' 取得失敗: ' + err.message);
        }
        await sleep(THROTTLE_MS);
      }
    }

    log('== 取得完了: ' + machines.length + '台 ==');
    lastMachines = machines;
    window.__slotAtspecs = await atspecsPromise;
    lastScores = computeScores(machines, window.__slotAtspecs);

    var hints = await getMergedHints(date);
    if (hints) renderHints(machines, lastScores, hints);
    renderRankings(machines, lastScores);
    renderKishuSummary(machines, lastScores, hints);
    renderRuns(machines, lastScores);

    var payload = JSON.stringify({
      ver: 1,
      action: 'collect',
      tenpoId: TENPO,
      targetDate: date,
      collectedAt: new Date().toISOString(),
      machines: machines
    });
    var uploaded = false;
    try {
      uploaded = await ghUpload(payload, date);
    } catch (eU) {
      if (String(eU.message).indexOf('401') !== -1) {
        log('サイト自動アップ失敗: トークンが無効です。上部の「設定」から登録し直してください');
        localStorage.removeItem('slot_gh_token');
      } else {
        log('サイト自動アップ失敗: ' + eU.message + ' (通信エラーの可能性。トークンは保持したまま、下のコピー画面を保険に表示します)');
      }
    }
    if (gasUrl) {
      log('GASへ送信中...');
      try {
        var res = await fetch(gasUrl, {
          method: 'POST',
          mode: 'cors',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: payload
        });
        var body = await res.text();
        log('送信結果: ' + body.slice(0, 300));
      } catch (e2) {
        log('cors送信失敗、no-corsで再送します: ' + e2.message);
        try {
          await fetch(gasUrl, { method: 'POST', mode: 'no-cors', body: payload });
          log('no-corsで送信しました(応答は確認できません)');
        } catch (e3) {
          log('送信できませんでした。下のコピー画面から手動で保存してください');
          showJsonCopy(payload);
        }
      }
    }
    if (!uploaded && !gasUrl) {
      log('自動アップ未設定のためコピー画面を表示します');
      showJsonCopy(payload);
    }
    log('== 完了。「中止/閉じる」で閉じてください ==');
  } catch (e) {
    log('エラー: ' + e.message);
  } finally {
    window.__slotCollectorRunning = false;
  }
})();
