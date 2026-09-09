/* rhythm.js(反応時間の集計)と store.js の CSV 生成の検算。
   使い方: node tools/rhythm-test.mjs */
import assert from 'node:assert';
import { plateRhythm, rhythmLabel, hitCount, perPlateAverage, setSeries, plateDirection, plateIndexOfShot, plateShots, reactionBin, perOrderStats, binHitRates, hitMissReaction, MIN_REACTION, shiftDate, dailySeries, monthlySeries, filterSetsByRange, hitRateGroups } from '../js/logic/rhythm.js';

let ng = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'NG  '} ${msg}`); if (!cond) ng++; };

// plateRhythm
check(plateRhythm([]) === null && plateRhythm([null, null]) === null && plateRhythm(undefined) === null, '有効値が無ければnull');
{
  const r = plateRhythm([2.0, 3.0, null, 4.0]);
  check(r.n === 3 && Math.abs(r.avg - 3.0) < 1e-9, '平均3.0・n=3(nullは除外)');
  check(Math.abs(r.sd - 1.0) < 1e-9, '標本標準偏差=1.0');
  check(r.min === 2.0 && r.max === 4.0 && r.over === 1, 'min/max/3秒超過(3.0ちょうどは超過でない)');
  check(rhythmLabel(r) === '3.00s ±1.00', `rhythmLabel: ${rhythmLabel(r)}`);
}
check(plateRhythm([2.5]).sd === 0, '1件なら標準偏差0');

// hitCount
check(hitCount(['hit', 'miss', 'hit']) === 2 && hitCount(undefined) === 0, 'hitCount');

// perPlateAverage
{
  const sets = [
    { reactions: [1.6, null, 3.5] },
    { reactions: [2.0, 2.0, null] },
  ];
  const pp = perPlateAverage(sets, 3);
  check(Math.abs(pp[0].avg - 1.8) < 1e-9 && pp[0].n === 2, '1枚目 平均1.8(n=2)');
  check(perPlateAverage([{ reactions: [1.2, 2.0] }], 2)[0] === null, '1.5秒未満(誤検出)は撃順別平均に入れない');
  check(pp[1].avg === 2.0 && pp[1].n === 1, '2枚目 平均2.0(n=1)');
  check(pp[2].avg === 3.5 && pp[2].n === 1, '3枚目 平均3.5(n=1)');
  check(perPlateAverage([], 15).every((p) => p === null), 'セットが無ければ全null');
}

// setSeries: 古い→新しい順、limitで末尾
{
  const sets = [
    { id: 'c', date: '2026-09-03', time: '20:00', plates: ['hit'], reactions: [2.0] },
    { id: 'a', date: '2026-09-01', time: '20:00', plates: [], reactions: [] },
    { id: 'b', date: '2026-09-02', time: '20:00', plates: ['hit', 'hit'], reactions: [] },
  ];
  const s = setSeries(sets, 2);
  check(s.length === 2 && s[0].id === 'b' && s[1].id === 'c', '古い→新しい順で末尾2件');
  check(s[0].rhythm === null && s[1].rhythm.avg === 2.0 && s[1].hits === 1, 'hits/rhythmが付く');
}

// 射撃方向と撃順→位置の対応
check(plateDirection({}) === 'ltr' && plateDirection({ direction: 'rtl' }) === 'rtl' && plateDirection({ direction: 'x' }) === 'ltr', '方向の既定はltr');
check(JSON.stringify(Array.from({ length: 15 }, (_, k) => plateIndexOfShot('rtl', k))) === JSON.stringify([4,3,2,1,0,9,8,7,6,5,14,13,12,11,10]), 'rtl: 各段で反転');
check(Array.from({ length: 15 }, (_, k) => plateIndexOfShot('ltr', k)).every((v, k) => v === k), 'ltr: 撃順=位置');
{
  // 物理位置: 下段左端✕、中段右2✕、上段左端・右2・右端✕
  const plates = ['miss','hit','hit','hit','hit', 'hit','hit','hit','miss','hit', 'miss','hit','hit','miss','miss'];
  const reactions = [2.5, 1.12, 2.7, 2.8, 3.2, 2.4, null, 2.6, 2.9, 2.7, 2.5, 2.6, 3.1, 2.8, 2.9];
  const s = { plates, reactions, direction: 'rtl' };
  const sh = plateShots(s);
  check(sh[0].idx === 4 && sh[4].idx === 0 && sh[4].hit === false, '←: 1枚目は下段右端、5枚目(左端)がミス');
  check(sh.filter((x) => !x.hit).map((x) => x.order).join(',') === '5,7,11,12,15', `ミスの撃順: ${sh.filter((x) => !x.hit).map((x) => x.order).join(',')}`);
  check(sh[1].reaction === null && sh[1].suspect === true && sh[6].reaction === null && sh[6].suspect === false, `${MIN_REACTION}秒未満はsuspect、nullは未検出`);
  check(plateRhythm(reactions).n === 13, '誤検出とnullを除いて13枚');
  check(reactionBin(1.12) === 'none' && reactionBin(2.39) === 'fast' && reactionBin(2.4) === 'mid' && reactionBin(3.0) === 'late' && reactionBin(3.01) === 'over', '帯の境界');
  const po = perOrderStats([s, { ...s, direction: 'ltr' }]);
  check(po[0].count === 2 && po[0].hit === 1 && po[0].n === 2, '撃順1枚目: ←では右端○、→では左端✕ → 1/2');
  const bins = binHitRates([s]);
  check(bins.find((b) => b.key === 'none').n === 2, '未検出帯=誤検出1+null1');
  const hm = hitMissReaction([s]);
  check(hm.shots === 15 && hm.suspect === 1 && hm.undetected === 1 && hm.hits.n + hm.misses.n === 13, 'ヒット/ミス比較の内訳');
}

// 期間の集計
check(shiftDate('2026-03-01', -1) === '2026-02-28' && shiftDate('2026-12-31', 1) === '2027-01-01' && shiftDate('2026-09-09', -6) === '2026-09-03', 'shiftDate: 月末・年末をまたぐ');
{
  const mk = (id, date, rs) => ({ id, date, time: '20:00', plates: new Array(15).fill('hit'), reactions: rs });
  const sets = [mk('a', '2026-09-09', [2.0, 3.0]), mk('b', '2026-09-09', [2.5]), mk('c', '2026-09-03', [2.6]), mk('d', '2026-08-20', [2.8]), mk('e', '2026-04-15', [2.9])];
  const d = dailySeries(sets, 7, '2026-09-09');
  check(d.length === 7 && d[0].date === '2026-09-03' && d[6].date === '2026-09-09', '日別: 7日分、古い→新しい');
  check(Math.abs(d[6].rhythm.avg - 2.5) < 1e-9 && d[6].rhythm.n === 3 && d[6].sets === 2 && d[6].label === '9/9', '日別: 同じ日の全セットをまとめて平均');
  check(d[3].rhythm === null && d[3].sets === 0, '日別: 記録の無い日はnull');
  const m = monthlySeries(sets, 6, '2026-09-09');
  check(m.length === 6 && m[0].date === '2026-04' && m[5].date === '2026-09' && m[0].label === '4月', '月別: 6か月分、古い→新しい');
  check(m[5].rhythm.n === 4 && m[4].rhythm.n === 1 && m[1].rhythm === null, '月別: 月内の全セットをまとめる');
  check(monthlySeries(sets, 3, '2026-01-15')[0].date === '2025-11', '月別: 年またぎ');
  check(filterSetsByRange(sets, { mode: 'sets', n: 2 }, '2026-09-09').map((s) => s.id).join('') === 'ab', '範囲: 直近2セット');
  check(filterSetsByRange(sets, { mode: 'weeks', n: 1 }, '2026-09-09').map((s) => s.id).join('') === 'abc', '範囲: 直近1週間(9/3〜9/9)');
  check(filterSetsByRange(sets, { mode: 'range', from: '2026-08-01', to: '2026-09-05' }, '2026-09-09').map((s) => s.id).join('') === 'cd', '範囲: 期間指定');
  const hg = hitRateGroups([{ plates: ['hit','miss','hit','hit','miss', ...new Array(10).fill('hit')], reactions: [2.3, 2.5, 2.7, null, 3.1, ...new Array(10).fill(null)] }]);
  check(hg.groups.map((g) => `${g.hit}/${g.n}`).join(' ') === '1/1 0/1 1/2' && hg.undetected === 11, `3群: ${hg.groups.map((g) => `${g.hit}/${g.n}`).join(' ')} 未検出${hg.undetected}`);
}

// CSV(store.js はブラウザ専用モジュールを import するので、最小のスタブを置いてから読む)
globalThis.window = { AudioContext: class {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { toCsv } = await import('../js/store.js');
{
  const csv = toCsv([{ id: 'x', date: '2026-09-10', time: '20:15', plates: ['hit', ...new Array(14).fill('miss')], reactions: [2.51, null, 3.35, ...new Array(12).fill(null)], settings: {}, note: 'メモ,"引用"' }]);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  check(lines[0].split(',').length === 9 + 15 + 15, `ヘッダ列数=39 (${lines[0].split(',').length})`);
  check(lines[1].startsWith('2026-09-10,20:15,左から右,1,2.93,0.59,1,2,"メモ,""引用""",1,0,0'), `1行目: ${lines[1].slice(0, 60)}`);
  check(lines[1].endsWith(',2.51,,3.35,,,,,,,,,,,,'), '反応列(未検出は空)');
  check(csv.startsWith('﻿'), 'BOM付き');
}

console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
