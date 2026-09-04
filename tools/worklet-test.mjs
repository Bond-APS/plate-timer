/* shot-worklet.js の検算(Node)。AudioWorklet のグローバルを偽物にして合成信号を流す。
   1) ブザー(持続音)は sustained、発砲(衝撃音)は onset として通知される
   2) 振幅の揺れるブザー(端末スピーカーの歪み/AGC想定)で onset が連発しない
   3) 残響のある部屋・小さい発砲でも onset が出る
   使い方: node tools/worklet-test.mjs [clip48k.wav]  (wavを渡すと実クリップでも確認) */
import { runWorklet, synth, buzzer, shot, readWavMono } from './worklet-harness.mjs';
import { fileURLToPath } from 'node:url';
const path = fileURLToPath(new URL('../js/components/shot-worklet.js', import.meta.url));
const sr = 48000;
let ng = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'NG  '} ${msg}`); if (!cond) ng++; };
const run = (x) => { const { msgs } = runWorklet(path, x, sr); return { on: msgs.filter((m) => m.type === 'onset').map((m) => m.time), sus: msgs.filter((m) => m.type === 'sustained').map((m) => m.time) }; };
const near = (arr, t, tol = 0.02) => arr.some((v) => Math.abs(v - t) <= tol);

{ const x = synth({ dur: 8 }); buzzer(x, sr, 2.0); buzzer(x, sr, 5.0);
  const r = run(x);
  check(r.on.length === 0, `きれいなブザーのみ: onset なし (${r.on.map((t) => t.toFixed(3))})`);
  check(near(r.sus, 2.0) && near(r.sus, 5.0), `ブザー2本が sustained として 2.0/5.0 に出る (${r.sus.map((t) => t.toFixed(3))})`); }
{ const x = synth({ dur: 8 }); buzzer(x, sr, 2.0, 1.0, 0.3, { modHz: 7, modDepth: 0.9 }); buzzer(x, sr, 5.0, 1.0, 0.3, { modHz: 7, modDepth: 0.9 }); shot(x, sr, 4.2);
  const r = run(x);
  check(r.on.length === 1 && near(r.on, 4.2), `揺れるブザー+発砲@4.2: onset は 4.2 のみ (${r.on.map((t) => t.toFixed(3))})`); }
{ const x = synth({ dur: 8 }); buzzer(x, sr, 2.0); shot(x, sr, 2.8); // ブザー鳴動中の発砲
  const r = run(x);
  check(near(r.on, 2.8), `ブザー鳴動中(0.8s後)の発砲も onset (${r.on.map((t) => t.toFixed(3))})`); }
{ const x = synth({ dur: 4 }); shot(x, sr, 1.5, 0.6, 0.8);
  const r = run(x); check(r.on.length === 1 && near(r.on, 1.5), `残響RT60=0.8s の発砲: onset 1.5 (${r.on.map((t) => t.toFixed(3))})`); }
{ const x = synth({ dur: 4 }); shot(x, sr, 1.5, 0.08, 0.4);
  const r = run(x); check(r.on.length === 1 && near(r.on, 1.5), `小さい発砲(振幅0.08): onset 1.5 (${r.on.map((t) => t.toFixed(3))})`); }
{ const x = synth({ dur: 4 }); shot(x, sr, 1.0); shot(x, sr, 2.5);
  const r = run(x); check(r.on.length === 2 && near(r.on, 1.0) && near(r.on, 2.5), `発砲2発: 1.0/2.5 (${r.on.map((t) => t.toFixed(3))})`); }
if (process.argv[2]) {
  const { x } = readWavMono(process.argv[2]);
  const r = run(x);
  check(near(r.sus, 4.317, 0.03) && near(r.sus, 7.31, 0.03), `実クリップ: 開始/終了ブザーが sustained (${r.sus.map((t) => t.toFixed(3))})`);
  check(!r.on.some((t) => t > 4.2 && t < 8.7), `実クリップ: ブザー区間に onset なし (${r.on.map((t) => t.toFixed(3))})`);
  const y = Float32Array.from(x); shot(y, sr, 6.31);
  const r2 = run(y); check(near(r2.on, 6.31), `実クリップ+発砲@6.31: onset 6.31 (${r2.on.map((t) => t.toFixed(3))})`);
}
console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
