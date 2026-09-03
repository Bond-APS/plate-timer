/* プレート3段×5枚グリッド(タップでhit/miss切替。readonly:true なら表示のみ) */

const ROW_LABELS = ['下段', '中段', '上段'];

/*
 * createPlateGrid({ plates:["hit"|"miss"...], onChange })
 * 配列は 0-4=下段(左→右), 5-9=中段, 10-14=上段。表示は上段が上。
 */
export function createPlateGrid(opts) {
  const root = document.createElement('div');
  root.className = 'plate-grid' + (opts.readonly ? ' readonly' : '');
  let plates = opts.plates.slice();

  function render() {
    const rows = plates.length / 5;
    let html = '';
    for (let r = rows - 1; r >= 0; r--) {
      html += `<div class="plate-row"><span class="plate-row-label">${ROW_LABELS[r]}</span>`;
      for (let i = 0; i < 5; i++) {
        const idx = r * 5 + i;
        const hit = plates[idx] === 'hit';
        html += `<button class="plate ${hit ? 'hit' : 'miss'}" data-idx="${idx}" title="${ROW_LABELS[r]}${i + 1}枚目">
          ${hit ? '' : '<span>✕</span>'}
        </button>`;
      }
      html += '</div>';
    }
    root.innerHTML = html;
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('.plate');
    if (!b || opts.readonly) return;
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
  };
}
