/* rhythm.js(反応時間の集計)と store.js の CSV 生成の検算。
   使い方: node tools/rhythm-test.mjs */
import assert from 'node:assert';
import { plateRhythm, rhythmLabel, hitCount, perPlateAverage, setSeries } from '../js/logic/rhythm.js';

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
    { reactions: [1.0, null, 3.5] },
    { reactions: [2.0, 2.0, null] },
  ];
  const pp = perPlateAverage(sets, 3);
  check(pp[0].avg === 1.5 && pp[0].n === 2, '1枚目 平均1.5(n=2)');
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

// CSV(store.js はブラウザ専用モジュールを import するので、最小のスタブを置いてから読む)
globalThis.window = { AudioContext: class {} };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
const { toCsv } = await import('../js/store.js');
{
  const csv = toCsv([{ id: 'x', date: '2026-09-10', time: '20:15', plates: ['hit', ...new Array(14).fill('miss')], reactions: [2.51, null, 3.35, ...new Array(12).fill(null)], settings: {}, note: 'メモ,"引用"' }]);
  const lines = csv.replace(/^﻿/, '').split('\r\n');
  check(lines[0].split(',').length === 8 + 15 + 15, `ヘッダ列数=38 (${lines[0].split(',').length})`);
  check(lines[1].startsWith('2026-09-10,20:15,1,2.93,0.59,1,2,"メモ,""引用""",1,0,0'), `1行目: ${lines[1].slice(0, 60)}`);
  check(lines[1].endsWith(',2.51,,3.35,,,,,,,,,,,,'), '反応列(未検出は空)');
  check(csv.startsWith('﻿'), 'BOM付き');
}

console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
