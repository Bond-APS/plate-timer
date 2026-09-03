/* 反応時間の集計(純関数。Nodeで検算可)。
   元アプリ score.js の plateRhythm() を切り出し、履歴グラフ用の集計を足したもの。 */

/* 1セットぶんの反応時間(秒、未検出はnull)の集計。有効値が無ければnull */
export function plateRhythm(reactions) {
  const rs = (reactions || []).filter((r) => typeof r === 'number' && Number.isFinite(r));
  if (!rs.length) return null;
  const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
  const sd = rs.length > 1 ? Math.sqrt(rs.reduce((a, r) => a + (r - avg) ** 2, 0) / (rs.length - 1)) : 0;
  return { n: rs.length, avg, sd, min: Math.min(...rs), max: Math.max(...rs), over: rs.filter((r) => r > 3.0).length };
}

/* リズムの短い表記: 「2.61s ±0.15」 */
export function rhythmLabel(r) {
  return r ? `${r.avg.toFixed(2)}s ±${r.sd.toFixed(2)}` : '';
}

export function hitCount(plates) {
  return (plates || []).filter((p) => p === 'hit').length;
}

/* 枚別(1〜15)の平均反応時間。sets は新しい順でも古い順でもよい */
export function perPlateAverage(sets, count = 15) {
  const sum = new Array(count).fill(0);
  const n = new Array(count).fill(0);
  for (const s of sets) {
    (s.reactions || []).forEach((r, i) => {
      if (i < count && typeof r === 'number' && Number.isFinite(r)) { sum[i] += r; n[i] += 1; }
    });
  }
  return sum.map((v, i) => (n[i] ? { avg: v / n[i], n: n[i] } : null));
}

/* セット別の推移(古い→新しい順に並べ替えて返す) */
export function setSeries(sets, limit = 20) {
  const sorted = [...sets].sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
  return sorted.slice(-limit).map((s) => ({ id: s.id, date: s.date, time: s.time, hits: hitCount(s.plates), rhythm: plateRhythm(s.reactions) }));
}
