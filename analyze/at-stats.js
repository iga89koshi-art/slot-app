// AT機向けの挙動統計(node at-stats.js <機種名の一部> [収集JSON])
// 大当り履歴(当選G数・出玉・時刻)から、設定差の出やすい観点を機種非依存で集計する:
//  - 初当り相当の当選率(連チャン玉切り離し後)
//  - 当選ゲーム数の分布(ゾーン・天井の挙動が見える)
//  - 1回の当たり(連チャン一塊)ごとの獲得枚数分布
// 機種ごとの設定差基準(ゾーン定義・直撃条件など)はmachines.jsonに追加していく。
const fs = require('fs');
const path = require('path');

const kishuQuery = process.argv[2] || '';
const dataPath = process.argv[3] || path.join(__dirname, '..', 'data', '2026-08-16.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// 連チャンのつなぎ目とみなす当選G数の閾値(既定: 32G以内は同一セットの連チャン扱い)
const RENCHAN_G = 33;

const BUCKETS = [50, 100, 150, 200, 300, 400, 500, 700, 1000, 9999];

function bucketLabel(i) {
  var lo = i === 0 ? 1 : BUCKETS[i - 1] + 1;
  var hi = BUCKETS[i] === 9999 ? '+' : '-' + BUCKETS[i];
  return lo + (BUCKETS[i] === 9999 ? '+' : hi);
}

const targets = data.machines.filter(function (m) {
  return m.kishuName.indexOf(kishuQuery) !== -1 && m.history && m.history.length;
});
if (!targets.length) {
  console.log('該当機種なし。例: node at-stats.js 東京喰種');
  process.exit(1);
}

console.log('機種絞り込み: "' + kishuQuery + '" → ' + targets.length + '台\n');

const bucketTotal = new Array(BUCKETS.length).fill(0);
let allFirstHits = 0, allGames = 0;

targets.forEach(function (m) {
  // 履歴は新しい順なので古い順に直す
  var hist = m.history.slice().sort(function (a, b) { return a.no - b.no; });

  // 連チャンの塊(セット)にまとめる: 当選G数がRENCHAN_G以下なら前の塊に連結
  var sets = [];
  hist.forEach(function (h) {
    if (sets.length && h.start <= RENCHAN_G) {
      var s = sets[sets.length - 1];
      s.dedama += (h.dedama || 0);
      s.hits++;
    } else {
      sets.push({ firstStart: h.start, dedama: h.dedama || 0, hits: 1, time: h.time });
    }
  });

  sets.forEach(function (s) {
    for (var i = 0; i < BUCKETS.length; i++) {
      if (s.firstStart <= BUCKETS[i]) { bucketTotal[i]++; break; }
    }
  });
  allFirstHits += sets.length;
  allGames += m.totalStart || 0;

  var dedamas = sets.map(function (s) { return s.dedama; }).sort(function (a, b) { return b - a; });
  var avg = dedamas.length ? Math.round(dedamas.reduce(function (a, b) { return a + b; }, 0) / dedamas.length) : 0;
  var tanpatsu = sets.filter(function (s) { return s.hits === 1; }).length;

  console.log('台' + m.daiban +
    ' 総' + (m.totalStart || '?') + 'G' +
    ' 初当り' + sets.length + '回(1/' + (m.totalStart && sets.length ? Math.round(m.totalStart / sets.length) : '?') + ')' +
    ' 平均獲得' + avg + '枚 最大' + (dedamas[0] || 0) + '枚' +
    ' 単発率' + (sets.length ? Math.round(100 * tanpatsu / sets.length) : 0) + '%' +
    ' 初当りG数:[' + sets.map(function (s) { return s.firstStart; }).join(',') + ']');
});

console.log('\n== ' + kishuQuery + ' 全台合算 ==');
console.log('総ゲーム数: ' + allGames + ' / 初当り: ' + allFirstHits + '回 (1/' + Math.round(allGames / allFirstHits) + ')');
console.log('初当りゲーム数の分布(ゾーン挙動):');
bucketTotal.forEach(function (c, i) {
  if (!c) return;
  console.log('  ' + String(bucketLabel(i)).padEnd(9) + ' ' + String(c).padStart(3) + '回 ' + '#'.repeat(c));
});
