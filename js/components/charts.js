/* 履歴グラフ(依存なしのSVG)。
   1) セット別: 平均反応時間を実線、平均±標準偏差を帯で。3.0秒の基準線つき
   2) 枚別(1〜15): 平均反応時間の棒グラフ。段の継ぎ目(5/10)に区切り線 */
import { esc, shortDate } from '../util.js';

const W = 360, H = 200, PAD = { l: 34, r: 10, t: 12, b: 26 };

function yScale(min, max) {
  const h = H - PAD.t - PAD.b;
  return (v) => PAD.t + h * (1 - (v - min) / (max - min));
}

function frame(inner, yMin, yMax, ticks) {
  const y = yScale(yMin, yMax);
  const grid = ticks.map((v) => `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}" class="ch-grid"/>
    <text x="${PAD.l - 6}" y="${(y(v) + 4).toFixed(1)}" class="ch-ylab">${v.toFixed(1)}</text>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img">${grid}${inner}</svg>`;
}

/* series: [{date, time, rhythm:{avg,sd}|null}] 古い→新しい順 */
export function rhythmTrendSvg(series) {
  const pts = series.map((s, i) => ({ i, s })).filter(({ s }) => s.rhythm);
  if (pts.length < 1) return '';
  const yMin = 1.0, yMax = 4.0;
  const y = yScale(yMin, yMax);
  const n = series.length;
  const x = (i) => PAD.l + (n === 1 ? (W - PAD.l - PAD.r) / 2 : ((W - PAD.l - PAD.r) * i) / (n - 1));
  const cl = (v) => Math.max(yMin, Math.min(yMax, v));
  const band = pts.length > 1
    ? `<path class="ch-band" d="${pts.map(({ i, s }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(cl(s.rhythm.avg + s.rhythm.sd)).toFixed(1)}`).join(' ')} ${[...pts].reverse().map(({ i, s }) => `L${x(i).toFixed(1)},${y(cl(s.rhythm.avg - s.rhythm.sd)).toFixed(1)}`).join(' ')} Z"/>`
    : '';
  const line = pts.length > 1
    ? `<path class="ch-line" d="${pts.map(({ i, s }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(cl(s.rhythm.avg)).toFixed(1)}`).join(' ')}"/>`
    : '';
  const dots = pts.map(({ i, s }) => `<circle cx="${x(i).toFixed(1)}" cy="${y(cl(s.rhythm.avg)).toFixed(1)}" r="3.2" class="ch-dot ${s.rhythm.avg > 3 ? 'over' : ''}"><title>${esc(shortDate(s.date))} ${esc(s.time)} 平均${s.rhythm.avg.toFixed(2)}s ±${s.rhythm.sd.toFixed(2)}</title></circle>`).join('');
  const ref = `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(3).toFixed(1)}" y2="${y(3).toFixed(1)}" class="ch-ref"/>`;
  const labels = series.map((s, i) => (n <= 8 || i % Math.ceil(n / 6) === 0 || i === n - 1)
    ? `<text x="${x(i).toFixed(1)}" y="${H - 8}" class="ch-xlab">${esc(shortDate(s.date))}</text>` : '').join('');
  return frame(band + ref + line + dots + labels, yMin, yMax, [1.5, 2.0, 2.5, 3.0, 3.5]);
}

/* perPlate: [{avg,n}|null ×15] */
export function perPlateSvg(perPlate) {
  if (!perPlate.some((p) => p)) return '';
  const yMin = 0, yMax = 4.0;
  const y = yScale(yMin, yMax);
  const n = perPlate.length;
  const slot = (W - PAD.l - PAD.r) / n;
  const bw = slot * 0.62;
  const bars = perPlate.map((p, i) => {
    const cx = PAD.l + slot * (i + 0.5);
    const lab = `<text x="${cx.toFixed(1)}" y="${H - 8}" class="ch-xlab">${i + 1}</text>`;
    if (!p) return lab;
    const v = Math.min(yMax, p.avg);
    return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${y(v).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(0) - y(v)).toFixed(1)}" rx="2" class="ch-bar ${p.avg > 3 ? 'over' : ''}"><title>${i + 1}枚目 平均${p.avg.toFixed(2)}s (${p.n}回)</title></rect>${lab}`;
  }).join('');
  const seps = [5, 10].map((k) => `<line x1="${(PAD.l + slot * k).toFixed(1)}" x2="${(PAD.l + slot * k).toFixed(1)}" y1="${PAD.t}" y2="${H - PAD.b}" class="ch-sep"/>`).join('');
  const rowLabs = ['下段', '中段', '上段'].map((t, r) => `<text x="${(PAD.l + slot * (r * 5 + 2.5)).toFixed(1)}" y="${PAD.t + 10}" class="ch-rowlab">${t}</text>`).join('');
  const ref = `<line x1="${PAD.l}" x2="${W - PAD.r}" y1="${y(3).toFixed(1)}" y2="${y(3).toFixed(1)}" class="ch-ref"/>`;
  return frame(seps + rowLabs + bars + ref, yMin, yMax, [1.0, 2.0, 3.0]);
}
