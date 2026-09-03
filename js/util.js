/* 小さな共通ユーティリティ(DOM生成・トースト・日付) */

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function dateStr(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function timeStr(d = new Date()) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

/* "2026-09-10" → "9/10" (表示用) */
export function shortDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? `${Number(m[2])}/${Number(m[3])}` : s || '';
}

/* "2026-09-10" → "2026年9月10日(木)" */
export function longDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return s || '';
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const w = '日月火水木金土'[d.getDay()];
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日(${w})`;
}

let toastTimer = null;
export function toast(msg, kind = 'ok', ms = 2600) {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = msg;
  box.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.className = ''; }, ms);
}

/* ホーム画面から起動した(standalone)か */
export function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

export function isIOS() {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/* ファイルを共有シート(対応端末)またはダウンロードで渡す。戻り値: 'share' | 'download' | 'cancel' */
export async function shareOrDownload(file, title = '') {
  if (navigator.canShare && navigator.share) {
    try {
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        return 'share';
      }
    } catch (err) {
      if (err?.name === 'AbortError') return 'cancel';
      // 共有に失敗したらダウンロードへ
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'download';
}
