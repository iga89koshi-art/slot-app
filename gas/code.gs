// スロットデータ収集バックエンド
// セットアップ:
//  1. Googleスプレッドシートを新規作成
//  2. 拡張機能 > Apps Script を開き、このファイルの内容を貼り付けて保存
//  3. デプロイ > 新しいデプロイ > 種類:ウェブアプリ
//     - 実行ユーザー: 自分 / アクセスできるユーザー: 全員
//  4. 発行されたウェブアプリURLを収集ブックマークレットの初回実行時に入力する

const SHEET_SNAP = 'snapshots';
const SHEET_HIST = 'history';

const SNAP_HEADER = ['savedAt', 'targetDate', 'collectedAt', 'tenpoId',
  'daiban', 'kishuNo', 'kishuName', 'kashitama',
  'bb', 'rb', 'games', 'bbProbDen', 'rbProbDen', 'gouseiDen',
  'maxDedama', 'totalStart', 'updatedAt'];
const HIST_HEADER = ['targetDate', 'daiban', 'no', 'start', 'dedama', 'type', 'time', 'kishuName'];

// 収集ブックマークレットから:
// { action:'collect', tenpoId, targetDate, collectedAt, machines:[{daiban,...,history:[...]}] }
function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const body = JSON.parse(e.postData.contents);
    const machines = body.machines || [];
    const now = new Date();

    const snapRows = machines.map(function (m) {
      return [now, body.targetDate || '', body.collectedAt || '', body.tenpoId || '',
        m.daiban, m.kishuNo, m.kishuName || '', m.kashitama || '',
        m.bb, m.rb, m.games, m.bbProb, m.rbProb, m.gousei,
        m.maxDedama, m.totalStart, m.updatedAt || ''];
    });
    const snapSheet = getSheet_(SHEET_SNAP, SNAP_HEADER);
    if (snapRows.length) {
      snapSheet.getRange(snapSheet.getLastRow() + 1, 1, snapRows.length, SNAP_HEADER.length)
        .setValues(snapRows);
    }

    // 大当り履歴は (日付|台番|大当り番号) で重複排除して蓄積する
    const histSheet = getSheet_(SHEET_HIST, HIST_HEADER);
    const existing = {};
    if (histSheet.getLastRow() > 1) {
      histSheet.getRange(2, 1, histSheet.getLastRow() - 1, 3).getValues().forEach(function (r) {
        existing[histKey_(r[0], r[1], r[2])] = true;
      });
    }
    const histRows = [];
    machines.forEach(function (m) {
      (m.history || []).forEach(function (h) {
        const key = histKey_(body.targetDate, m.daiban, h.no);
        if (existing[key]) return;
        existing[key] = true;
        histRows.push([body.targetDate || '', m.daiban, h.no, h.start, h.dedama,
          h.type || '', h.time || '', m.kishuName || '']);
      });
    });
    if (histRows.length) {
      histSheet.getRange(histSheet.getLastRow() + 1, 1, histRows.length, HIST_HEADER.length)
        .setValues(histRows);
    }

    return jsonOut_({ ok: true, snapshots: snapRows.length, historyAdded: histRows.length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

// 分析PWAから:
//   ?mode=snapshots&days=N          直近N日分のスナップショット
//   ?mode=history&date=YYYY-MM-DD   指定日の大当り履歴(daiban指定で絞り込み可)
function doGet(e) {
  const p = e.parameter || {};
  const mode = p.mode || 'snapshots';
  try {
    if (mode === 'history') {
      const sheet = getSheet_(SHEET_HIST, HIST_HEADER);
      const rows = readAll_(sheet, HIST_HEADER).filter(function (r) {
        if (p.date && dateStr_(r.targetDate) !== p.date) return false;
        if (p.daiban && String(r.daiban) !== String(p.daiban)) return false;
        return true;
      });
      return jsonOut_({ ok: true, rows: rows });
    }
    const days = Number(p.days || 7);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sheet = getSheet_(SHEET_SNAP, SNAP_HEADER);
    const rows = readAll_(sheet, SNAP_HEADER).filter(function (r) {
      return r.savedAt instanceof Date && r.savedAt >= since;
    });
    return jsonOut_({ ok: true, rows: rows });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function histKey_(date, daiban, no) {
  return dateStr_(date) + '|' + daiban + '|' + no;
}

function dateStr_(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v);
}

function readAll_(sheet, header) {
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, header.length).getValues()
    .map(function (r) {
      const o = {};
      header.forEach(function (h, i) { o[h] = r[i]; });
      return o;
    });
}

function getSheet_(name, header) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(header);
  }
  return sheet;
}
