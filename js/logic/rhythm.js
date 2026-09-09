/* 反応時間の集計(純関数。Nodeで検算可)。
   元アプリ score.js の plateRhythm() / plateShots() を切り出し、履歴グラフ用の集計を足したもの。

   データの持ち方:
   - plates[]    = 物理位置(0-4=下段左→右, 5-9=中段, 10-14=上段)のヒット/ミス
   - reactions[] = 撃順(1枚目→15枚目)の開始ブザー→発砲の秒数(未検出はnull)
   - direction   = 射撃方向指定 "ltr"(→ 各段を左から右)|"rtl"(← 右から左)。未設定は ltr
   撃順と物理位置の対応は plateIndexOfShot / plateShots だけが解く。 */

export const PLATE_DIRECTIONS = { ltr: '→ 左から右', rtl: '← 右から左' };

export function plateDirection(set) {
  return set && set.direction === 'rtl' ? 'rtl' : 'ltr';
}

/* 撃順k(0始まり)→ plates[] の位置index */
export function plateIndexOfShot(direction, k) {
  const row = Math.floor(k / 5);
  const col = k % 5;
  return row * 5 + (direction === 'rtl' ? 4 - col : col);
}

/* 反応時間の妥当性: 挙銃だけで1.0〜2.0秒かかるため、開始ブザーから1.5秒未満の「発砲」は物理的にあり得ない。
   ブザー鳴動中の音をマイクが発砲と誤検出した値なので、集計では未検出と同じ扱いにする(保存値は書き換えない) */
export const MIN_REACTION = 1.5;
export function validReaction(r) {
  return typeof r === 'number' && Number.isFinite(r) && r >= MIN_REACTION;
}
export function suspectReaction(r) {
  return typeof r === 'number' && Number.isFinite(r) && r < MIN_REACTION;
}

/* 撃順に並べた1枚ごとの記録: {order(1始まり), idx(物理位置), row(0下/1中/2上), col(0左→4右), hit, reaction(秒|null), suspect} */
export function plateShots(set) {
  const plates = set.plates || [];
  const reactions = set.reactions || [];
  const dir = plateDirection(set);
  return plates.map((_, k) => {
    const idx = plateIndexOfShot(dir, k);
    const r = reactions[k];
    return {
      order: k + 1, idx, row: Math.floor(idx / 5), col: idx % 5,
      hit: plates[idx] === 'hit',
      reaction: validReaction(r) ? r : null,
      suspect: suspectReaction(r),
    };
  });
}

/* 反応時間の区分(タイミングとヒット/ミスの関係を見るための帯)。
   2.95〜3.30秒は終了ブザーのマスク窓と重なり検出できないので、「3秒超過」に入る値は実質3.3秒以降 */
export const REACTION_BINS = [
  { key: 'fast', label: '〜2.4秒', test: (r) => r < 2.4 },
  { key: 'mid', label: '2.4〜2.7秒', test: (r) => r >= 2.4 && r < 2.7 },
  { key: 'late', label: '2.7〜3.0秒', test: (r) => r >= 2.7 && r <= 3.0 },
  { key: 'over', label: '3.3秒〜', test: (r) => r > 3.0 },
];
export function reactionBin(r) {
  if (!validReaction(r)) return 'none';
  return (REACTION_BINS.find((b) => b.test(r)) || REACTION_BINS[REACTION_BINS.length - 1]).key;
}

/* 1セットぶんの反応時間(秒、未検出はnull)の集計。有効値が無ければnull */
export function plateRhythm(reactions) {
  const rs = (reactions || []).filter(validReaction);
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

/* 撃順別(1〜15枚目)の平均反応時間。sets は新しい順でも古い順でもよい */
export function perPlateAverage(sets, count = 15) {
  const sum = new Array(count).fill(0);
  const n = new Array(count).fill(0);
  for (const s of sets) {
    (s.reactions || []).forEach((r, i) => {
      if (i < count && validReaction(r)) { sum[i] += r; n[i] += 1; }
    });
  }
  return sum.map((v, i) => (n[i] ? { avg: v / n[i], n: n[i] } : null));
}

/* 撃順別のヒット率と平均反応時間(射撃方向を解いてから数える): [{count, hit, n, avg|null} ×count] */
export function perOrderStats(sets, count = 15) {
  const acc = Array.from({ length: count }, () => ({ count: 0, hit: 0, n: 0, sum: 0 }));
  for (const s of sets) {
    for (const sh of plateShots(s)) {
      if (sh.order > count) continue;
      const a = acc[sh.order - 1];
      a.count++;
      if (sh.hit) a.hit++;
      if (sh.reaction != null) { a.n++; a.sum += sh.reaction; }
    }
  }
  return acc.map((a) => ({ count: a.count, hit: a.hit, n: a.n, avg: a.n ? a.sum / a.n : null }));
}

/* 反応時間の帯ごとのヒット率: [{key, label, hit, n}](未検出=noneも1つの帯) */
export function binHitRates(sets) {
  const bins = [...REACTION_BINS.map((b) => ({ key: b.key, label: b.label, hit: 0, n: 0 })), { key: 'none', label: '未検出', hit: 0, n: 0 }];
  const byKey = new Map(bins.map((b) => [b.key, b]));
  for (const s of sets) {
    for (const sh of plateShots(s)) {
      const b = byKey.get(reactionBin(sh.reaction));
      b.n++;
      if (sh.hit) b.hit++;
    }
  }
  return bins;
}

/* ヒット時とミス時の反応時間の比較: {hits:{n,avg,sd}, misses:{n,avg,sd}, suspect, undetected, shots} */
export function hitMissReaction(sets) {
  const hits = [], misses = [];
  let suspect = 0, undetected = 0, shots = 0;
  for (const s of sets) {
    for (const sh of plateShots(s)) {
      shots++;
      if (sh.suspect) { suspect++; continue; }
      if (sh.reaction == null) { undetected++; continue; }
      (sh.hit ? hits : misses).push(sh.reaction);
    }
  }
  const stat = (a) => {
    if (!a.length) return { n: 0, avg: null, sd: null };
    const avg = a.reduce((x, y) => x + y, 0) / a.length;
    const sd = a.length > 1 ? Math.sqrt(a.reduce((x, r) => x + (r - avg) ** 2, 0) / (a.length - 1)) : 0;
    return { n: a.length, avg, sd };
  };
  return { hits: stat(hits), misses: stat(misses), suspect, undetected, shots };
}

/* セット別の推移(古い→新しい順に並べ替えて返す) */
export function setSeries(sets, limit = 20) {
  const sorted = [...sets].sort((a, b) => (a.date + a.time + a.id).localeCompare(b.date + b.time + b.id));
  return sorted.slice(-limit).map((s) => ({ id: s.id, date: s.date, time: s.time, hits: hitCount(s.plates), rhythm: plateRhythm(s.reactions) }));
}

/* ---------- 期間の集計(履歴画面の表示範囲切替) ---------- */

/* "YYYY-MM-DD" に日数を足す(純関数。タイムゾーンの影響を受けないようUTCで計算) */
export function shiftDate(ymd, days) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd || '');
  if (!m) return ymd;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

/* 日ごとの反応時間: today を含む直近 days 日分。[{date, label:"9/8", rhythm|null, sets}] 古い→新しい順。
   その日の全セットの反応時間をまとめて平均±ばらつきにする */
export function dailySeries(sets, days, today) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = shiftDate(today, -i);
    const day = sets.filter((s) => s.date === date);
    const rs = day.flatMap((s) => s.reactions || []);
    out.push({ date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8))}`, rhythm: plateRhythm(rs), sets: day.length });
  }
  return out;
}

/* 月ごとの反応時間: today の月を含む直近 months か月分。[{date:"YYYY-MM", label:"9月", rhythm|null, sets}] 古い→新しい順 */
export function monthlySeries(sets, months, today) {
  const y0 = Number(today.slice(0, 4)), m0 = Number(today.slice(5, 7));
  const out = [];
  for (let i = months - 1; i >= 0; i--) {
    const t = m0 - 1 - i;
    const y = y0 + Math.floor(t / 12);
    const m = ((t % 12) + 12) % 12 + 1;
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const mon = sets.filter((s) => (s.date || '').startsWith(key));
    const rs = mon.flatMap((s) => s.reactions || []);
    out.push({ date: key, label: `${m}月`, rhythm: plateRhythm(rs), sets: mon.length });
  }
  return out;
}

/* 表示範囲でセットを絞る。range = {mode:'sets', n} | {mode:'weeks', n} | {mode:'range', from, to}。
   sets は新しい順で渡す(mode:'sets' は先頭 n 件) */
export function filterSetsByRange(sets, range, today) {
  const r = range || {};
  if (r.mode === 'weeks') {
    const n = Math.max(1, Number(r.n) || 1);
    const since = shiftDate(today, -(7 * n - 1));
    return sets.filter((s) => s.date >= since && s.date <= today);
  }
  if (r.mode === 'range') {
    const from = r.from || '0000-00-00';
    const to = r.to || '9999-12-31';
    return sets.filter((s) => s.date >= from && s.date <= to);
  }
  const n = Math.max(1, Number(r.n) || 5);
  return sets.slice(0, n);
}

/* 反応時間3群(〜2.4 / 2.4〜2.7 / 2.7〜)のヒット率。未検出・誤検出は群に入れず件数だけ返す */
export const HIT_GROUPS = [
  { key: 'fast', label: '〜2.4秒', test: (r) => r < 2.4 },
  { key: 'mid', label: '2.4〜2.7秒', test: (r) => r >= 2.4 && r < 2.7 },
  { key: 'late', label: '2.7秒〜', test: (r) => r >= 2.7 },
];
export function hitRateGroups(sets) {
  const groups = HIT_GROUPS.map((g) => ({ key: g.key, label: g.label, hit: 0, n: 0 }));
  let undetected = 0;
  for (const s of sets) {
    for (const sh of plateShots(s)) {
      if (sh.reaction == null) { undetected++; continue; }
      const g = groups[HIT_GROUPS.findIndex((x) => x.test(sh.reaction))];
      g.n++;
      if (sh.hit) g.hit++;
    }
  }
  return { groups, undetected };
}
