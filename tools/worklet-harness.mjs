// shot-worklet.js を Node で回す簡易ハーネス。信号を128サンプルずつ流し、postMessage を集める
import { readFileSync } from 'node:fs';
import { readWavMono } from './analyze-clip.mjs';

export function runWorklet(path, x, sr = 48000) {
  const msgs = [];
  const g = globalThis;
  g.sampleRate = sr;
  g.__t = 0;
  Object.defineProperty(g, 'currentTime', { get: () => g.__t, configurable: true });
  let Cls = null;
  g.AudioWorkletProcessor = class { constructor() { this.port = { postMessage: (m) => msgs.push({ ...m }), onmessage: null }; } };
  g.registerProcessor = (name, c) => { Cls = c; };
  const src = readFileSync(path, 'utf8');
  new Function(src)(); // モジュールではなく素のスクリプトとして評価
  const p = new Cls();
  for (let off = 0; off + 128 <= x.length; off += 128) {
    g.__t = off / sr;
    p.process([[x.subarray(off, off + 128)]]);
  }
  return { msgs, proc: p };
}

export function synth({ sr = 48000, dur = 12, noise = 0.003 } = {}) {
  const x = new Float32Array(sr * dur);
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * noise;
  return x;
}
/* 矩形波っぽいブザー(実クリップ同様、2kHz超にも成分がある)。mod>0 で振幅を modHz で変調(端末スピーカーの歪み/AGCの再現) */
export function buzzer(x, sr, t0, dur = 1.0, amp = 0.3, { modHz = 0, modDepth = 0 } = {}) {
  const s = Math.round(t0 * sr), n = Math.round(dur * sr), ramp = Math.round(0.005 * sr);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let v = 0;
    for (let k = 1; k <= 25; k += 2) v += Math.sin(2 * Math.PI * 200 * k * t) / k; // 奇数次倍音(矩形波)
    let g = 1;
    if (i < ramp) g = i / ramp; if (i > n - ramp) g = (n - i) / ramp;
    if (modHz) g *= 1 - modDepth * (0.5 + 0.5 * Math.sin(2 * Math.PI * modHz * t));
    x[s + i] += amp * g * v;
  }
}
/* 発砲: 広帯域バースト + 残響(RT60秒) */
export function shot(x, sr, t0, amp = 0.6, rt60 = 0.4) {
  const s = Math.round(t0 * sr), n = Math.round(0.006 * sr);
  for (let i = 0; i < n; i++) x[s + i] += (Math.random() * 2 - 1) * amp * (1 - i / n);
  const tail = Math.round(0.6 * sr);
  for (let i = 0; i < tail; i++) x[s + n + i] += (Math.random() * 2 - 1) * amp * 0.15 * Math.pow(10, -3 * (i / sr) / rt60);
}
export { readWavMono };
