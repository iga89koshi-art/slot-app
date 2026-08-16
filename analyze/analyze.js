// 設定推測エンジン(node analyze.js <収集JSON>)
// BB回数・RB回数を総ゲーム数に対する二項分布として各設定の尤度を計算し、
// 一様事前分布で設定1〜6の事後確率を出す。将来PWAに同ロジックを移植する。
const fs = require('fs');
const path = require('path');

const dataPath = process.argv[2] || path.join(__dirname, '..', 'data', '2026-08-16.json');
const specs = JSON.parse(fs.readFileSync(path.join(__dirname, 'machines.json'), 'utf8'));
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const MIN_GAMES = 2000; // 試行が少なすぎる台は判別困難として除外

function binomLogLik(k, n, p) {
  // 定数項(組合せ)は設定間で共通なので省略
  return k * Math.log(p) + (n - k) * Math.log(1 - p);
}

function posterior(m, spec) {
  const n = m.totalStart;
  const logliks = spec.settings.map(function (st) {
    return binomLogLik(m.bb, n, 1 / st.bb) + binomLogLik(m.rb, n, 1 / st.rb);
  });
  const max = Math.max.apply(null, logliks);
  const ws = logliks.map(function (l) { return Math.exp(l - max); });
  const sum = ws.reduce(function (a, b) { return a + b; }, 0);
  return ws.map(function (w) { return w / sum; });
}

const results = [];
data.machines.forEach(function (m) {
  const spec = specs[m.kishuName];
  if (!spec || !spec.settings) return;
  if (m.totalStart == null || m.totalStart < MIN_GAMES || m.bb == null || m.rb == null) return;
  const post = posterior(m, spec);
  const pHigh = post[4] + post[5]; // 設5+設6
  const p456 = post[3] + post[4] + post[5];
  results.push({
    daiban: m.daiban,
    kishu: spec.displayName,
    games: m.totalStart,
    bb: m.bb,
    rb: m.rb,
    bbRate: m.totalStart && m.bb ? Math.round(m.totalStart / m.bb) : null,
    rbRate: m.totalStart && m.rb ? Math.round(m.totalStart / m.rb) : null,
    gousei: m.totalStart && (m.bb + m.rb) ? Math.round(m.totalStart / (m.bb + m.rb)) : null,
    post: post.map(function (p) { return Math.round(p * 100); }),
    p56: Math.round(pHigh * 100),
    p456: Math.round(p456 * 100)
  });
});

results.sort(function (a, b) { return b.p56 - a.p56; });

console.log('台番 | 機種 | G数 | BB | RB | 合成 | 設1..6事後確率% | P(設5,6)% | P(設4-6)%');
results.forEach(function (r) {
  console.log(
    r.daiban + ' | ' + r.kishu + ' | ' + r.games + ' | ' +
    r.bb + '(1/' + r.bbRate + ') | ' + r.rb + '(1/' + r.rbRate + ') | 1/' + r.gousei +
    ' | [' + r.post.join(',') + '] | ' + r.p56 + ' | ' + r.p456
  );
});
