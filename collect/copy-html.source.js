// HTMLコピー用ブックマークレット(読みやすい版)
// 店内でデータサイトを開いた状態で実行すると、ページ全体のHTMLを
// クリップボードにコピーできるオーバーレイを表示する。
// 実際にブックマークに登録するのは copy-html.bookmarklet.txt の1行。
(function () {
  var html =
    '<!-- URL: ' + location.href + ' -->\n' +
    '<!-- 取得日時: ' + new Date().toLocaleString('ja-JP') + ' -->\n' +
    '<!DOCTYPE html>\n' + document.documentElement.outerHTML;

  var overlay = document.createElement('div');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#fff;' +
    'padding:12px;display:flex;flex-direction:column;gap:8px;';

  var copyBtn = document.createElement('button');
  copyBtn.textContent = 'HTMLをコピー(約' + Math.round(html.length / 1024) + 'KB)';
  copyBtn.style.cssText = 'padding:14px;font-size:16px;background:#2b6;color:#fff;border:0;border-radius:8px;';

  var ta = document.createElement('textarea');
  ta.value = html;
  ta.readOnly = true;
  ta.style.cssText = 'flex:1;width:100%;font-size:11px;border:1px solid #ccc;';

  var closeBtn = document.createElement('button');
  closeBtn.textContent = '閉じる';
  closeBtn.style.cssText = 'padding:10px;font-size:14px;border:1px solid #ccc;border-radius:8px;background:#eee;';

  copyBtn.onclick = function () {
    ta.select();
    ta.setSelectionRange(0, html.length);
    var done = function () { copyBtn.textContent = 'コピーしました!チャットに貼ってください'; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(html).then(done, function () {
        document.execCommand('copy'); done();
      });
    } else {
      document.execCommand('copy'); done();
    }
  };
  closeBtn.onclick = function () { overlay.remove(); };

  overlay.appendChild(copyBtn);
  overlay.appendChild(ta);
  overlay.appendChild(closeBtn);
  document.body.appendChild(overlay);
})();
