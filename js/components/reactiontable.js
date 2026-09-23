/* 反応時間の表(3段×5枚)。実際の的の配置どおりに 上段/中段/下段 を上から並べ、各マスに
   その的を撃ったときの反応時間を入れる。撃順(1〜15)は射撃方向(→ ltr / ← rtl)から解いて各マスの上に小さく出す
   (撃順1〜5=下段、6〜10=中段、11〜15=上段。段の中の並びが方向で反転する。対応は logic/rhythm.js の plateIndexOfShot)。
   タイマー実行中の表(platepanel)と結果入力の表(timer 画面)で共用する。
   色は例外だけに使う(3秒超過=赤、未検出/誤検出=灰)。3秒以内は通常の文字色で、数字そのものを読ませる。

   cells: 撃順の長さ15の配列(cells[0]=1枚目)。各要素 { value:秒|null, state, mark }
     state: 'pending'(まだ撃っていない) | 'ok' | 'over'(3秒超過) | 'none'(検出できず) | 'suspect'(1.5秒未満=誤検出)
     mark:  'hit' | 'miss' | null(結果入力でヒット/ミスを重ねるとき)
   direction: 'ltr' | 'rtl'(射撃方向)
   current: 今の枚(撃順1〜15。0なら無し)。実行中の枚を枠で示す */
import { plateIndexOfShot } from '../logic/rhythm.js';

const ROWS = ['下段', '中段', '上段'];
const STATE_TEXT = { none: '検出なし', suspect: '誤検出', pending: '未計測' };

export function reactionCell(value, { over = 3.0, min = 1.5, finalized = true } = {}) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value < min) return { value, state: 'suspect' };
    return { value, state: value > over ? 'over' : 'ok' };
  }
  return { value: null, state: finalized ? 'none' : 'pending' };
}

export function reactionTableHtml(cells, { direction = 'ltr', current = 0, caption = '' } = {}) {
  // 物理位置 idx → 撃順 k の逆引き
  const orderAt = new Array(15);
  for (let k = 0; k < 15; k++) orderAt[plateIndexOfShot(direction, k)] = k;
  let html = `<table class="rt">${caption ? `<caption class="sr-only">${caption}</caption>` : ''}<tbody>`;
  for (let r = 2; r >= 0; r--) { // 上段を上に(実際の的の配置)
    html += `<tr><th scope="row">${ROWS[r]}</th>`;
    for (let c = 0; c < 5; c++) {
      const k = orderAt[r * 5 + c];
      const cell = cells[k] || { value: null, state: 'pending' };
      const no = k + 1;
      const mark = cell.mark === 'hit' ? '<span class="rt-mark hit" aria-hidden="true">○</span>'
        : cell.mark === 'miss' ? '<span class="rt-mark miss" aria-hidden="true">✕</span>' : '';
      const val = cell.state === 'ok' || cell.state === 'over' ? cell.value.toFixed(2)
        : cell.state === 'none' ? '−'
        : cell.state === 'suspect' ? '誤検出' : '';
      const label = `${ROWS[r]}${c + 1}番目の的(${no}枚目) ${cell.state === 'ok' || cell.state === 'over' ? `${cell.value.toFixed(2)}秒${cell.state === 'over' ? ' 3秒超過' : ''}` : STATE_TEXT[cell.state]}` +
        (cell.mark ? ` ${cell.mark === 'hit' ? 'ヒット' : 'ミス'}` : '');
      const cls = ['rt-cell', cell.state, no === current ? 'current' : '', cell.mark ? `m-${cell.mark}` : ''].filter(Boolean).join(' ');
      const tip = cell.state === 'suspect' ? ' title="1.5秒未満はブザーの誤検出として集計から外します"' : '';
      html += `<td class="${cls}" aria-label="${label}"${tip}><span class="rt-head"><span class="rt-no">${no}</span>${mark}</span><span class="rt-v">${val}</span></td>`;
    }
    html += '</tr>';
  }
  return html + '</tbody></table>';
}

/* 射撃方向の切替(→ 左から右 / ← 右から左)。タイマー画面の「練習の条件」で開始前に選ぶ */
export function directionSegHtml(direction) {
  return `<div class="seg dir-seg" role="group" aria-label="射撃方向指定">
    <button type="button" data-dir="ltr" class="${direction === 'rtl' ? '' : 'active'}" aria-pressed="${direction !== 'rtl'}">→ 左から右</button>
    <button type="button" data-dir="rtl" class="${direction === 'rtl' ? 'active' : ''}" aria-pressed="${direction === 'rtl'}">← 右から左</button>
  </div>`;
}

/* 表の下に置く要約(平均・最速・最遅・3秒超過)。r は logic/rhythm.js の plateRhythm の戻り値 */
export function reactionSummaryHtml(r, extra = '') {
  if (!r) return '';
  return `<div class="rt-sum">
    <div><span class="rt-sum-l">平均</span><b>${r.avg.toFixed(2)}</b><small>s</small></div>
    <div><span class="rt-sum-l">最速</span><b>${r.min.toFixed(2)}</b><small>s</small></div>
    <div><span class="rt-sum-l">最遅</span><b>${r.max.toFixed(2)}</b><small>s</small></div>
    <div class="${r.over ? 'is-over' : ''}"><span class="rt-sum-l">3秒超過</span><b>${r.over}</b><small>枚</small></div>
  </div>${extra ? `<div class="rt-sum-note">${extra}</div>` : ''}`;
}
