/* プレート3段×5枚グリッド(タップでhit/miss切替。readonly:true なら表示のみ)+ 射撃方向指定(→/←) */
import { plateIndexOfShot } from '../logic/rhythm.js';

const ROW_LABELS = ['下段', '中段', '上段'];
const COL_LABELS = ['左端', '左2', '中央', '右2', '右端'];

/*
 * createPlateGrid({ plates:["hit"|"miss"...], direction:"ltr"|"rtl", hint(HTML文字列, 省略可), readonly, directionEditable, compact, onChange(plates), onDirectionChange(dir) })
 * readonly は的のタップを止める。directionEditable:true なら readonly でも射撃方向だけは変えられる(履歴の修正用)
 * hint は方向ボタンの下に的の列と同じ幅で出す説明文。再描画で消えないよう部品側で描く(外から appendChild しない)。
 * 配列は 0-4=下段(左→右), 5-9=中段, 10-14=上段 の物理位置。表示は上段が上。
 * 射撃方向は公式スコアシートの「射撃方向指定」に合わせ、グリッドの下に →/← で選ぶ。
 * 各プレートの上部に撃順(1〜15)を出し、方向を切り替えると番号が反転する。
 */
export function createPlateGrid(opts) {
  const root = document.createElement('div');
  root.className = 'plate-grid-wrap' + (opts.readonly ? ' readonly' : '') + (opts.compact ? ' compact' : '');
  let plates = opts.plates.slice();
  let direction = opts.direction === 'rtl' ? 'rtl' : 'ltr';
  const dirEditable = !opts.readonly || !!opts.directionEditable;

  function orderOf(idx) {
    const total = plates.length;
    for (let k = 0; k < total; k++) if (plateIndexOfShot(direction, k) === idx) return k + 1;
    return idx + 1;
  }

  function render() {
    const rows = plates.length / 5;
    let html = '<div class="plate-grid">';
    for (let r = rows - 1; r >= 0; r--) {
      html += `<div class="plate-row"><span class="plate-row-label"><span class="lbl-full">${ROW_LABELS[r]}</span><span class="lbl-short">${ROW_LABELS[r][0]}</span></span>`;
      for (let i = 0; i < 5; i++) {
        const idx = r * 5 + i;
        const hit = plates[idx] === 'hit';
        const order = orderOf(idx);
        html += `<button type="button" class="plate ${hit ? 'hit' : 'miss'}" data-idx="${idx}" title="${order}枚目(${ROW_LABELS[r]}・${COL_LABELS[i]})" aria-label="${order}枚目 ${hit ? 'ヒット' : 'ミス'}" aria-pressed="${hit}">
          <i class="plate-order">${order}</i>${hit ? '' : '<span>✕</span>'}
        </button>`;
      }
      html += '</div>';
    }
    html += '</div>';
    // 方向ボタンは段と同じ行構造(空の段ラベル+本体)にして、的の列の真下に揃える
    html += `<div class="plate-row"><span class="plate-row-label"></span>
      <div class="plate-dir" role="group" aria-label="射撃方向指定">
        <button type="button" class="plate-dir-btn ${direction === 'ltr' ? 'active' : ''}" data-dir="ltr" title="左から右へ撃つ" ${dirEditable ? '' : 'disabled'}>→</button>
        <span class="plate-dir-label">射撃方向指定</span>
        <button type="button" class="plate-dir-btn ${direction === 'rtl' ? 'active' : ''}" data-dir="rtl" title="右から左へ撃つ" ${dirEditable ? '' : 'disabled'}>←</button>
      </div></div>`;
    if (opts.hint) html += `<div class="plate-row"><span class="plate-row-label"></span><div class="small muted plate-hint">${opts.hint}</div></div>`;
    root.innerHTML = html;
  }

  root.addEventListener('click', (e) => {
    const dirBtn = e.target.closest('.plate-dir-btn');
    if (dirBtn && !dirEditable) return;
    if (!dirBtn && opts.readonly) return;
    if (dirBtn) {
      if (dirBtn.dataset.dir !== direction) {
        direction = dirBtn.dataset.dir;
        render();
        opts.onDirectionChange?.(direction);
      }
      return;
    }
    const b = e.target.closest('.plate');
    if (!b) return;
    const idx = Number(b.dataset.idx);
    plates[idx] = plates[idx] === 'hit' ? 'miss' : 'hit';
    render();
    opts.onChange?.(plates);
  });

  render();
  return {
    root,
    getPlates: () => plates.slice(),
    setPlates(next) { plates = next.slice(); render(); },
    getDirection: () => direction,
    setDirection(dir) { direction = dir === 'rtl' ? 'rtl' : 'ltr'; render(); },
  };
}
