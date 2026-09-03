/* 開発用: プレート実音声クリップ(wav化したもの)からブザー時刻・周波数を実測し、
   public/js/logic/plateclip.js に貼る定数を出力する。
   使い方: ffmpeg -i public/audio/plate-call.m4a -ac 1 -ar 16000 clip.wav
           node tools/analyze-clip.mjs clip.wav */
import { readFileSync } from 'node:fs';
import { envelopeDb, detectOnsets, detectBuzzers, pairBuzzers } from '../js/logic/shotanalysis.js';

export function readWavMono(path) {
  const buf = readFileSync(path);
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAVではありません');
  let off = 12, fmt = null, data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), sr: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    if (id === 'data') data = buf.subarray(off + 8, off + 8 + size);
    off += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('fmt/dataチャンクがありません');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error(`16bit PCMのみ対応(format=${fmt.format}, bits=${fmt.bits})`);
  const frames = Math.floor(data.length / 2 / fmt.channels);
  const x = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) s += data.readInt16LE((i * fmt.channels + c) * 2);
    x[i] = s / fmt.channels / 32768;
  }
  return { x, sr: fmt.sr };
}

/* 窓内の主要周波数をゼロクロッシングで推定 */
function estimateFreq(x, sr, startSec, durSec = 0.15) {
  const s = Math.round(startSec * sr);
  const e = Math.min(x.length, s + Math.round(durSec * sr));
  let crossings = 0;
  for (let i = s + 1; i < e; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++;
  return crossings / 2 / ((e - s) / sr);
}

import { pathToFileURL } from 'node:url';
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain && process.argv[2]) {
  const { x, sr } = readWavMono(process.argv[2]);
  console.log(`sr=${sr}, dur=${(x.length / sr).toFixed(3)}s`);

  const env = envelopeDb(x, sr, 2, 5);
  const onsets = detectOnsets(env, { thresholdDb: 12, riseDb: 6, refractoryMs: 200 });
  console.log('広帯域オンセット:', onsets.map((t) => t.toFixed(3)).join(', '));

  for (const t of onsets) {
    console.log(`  t=${t.toFixed(3)}s の推定周波数: ${estimateFreq(x, sr, t + 0.02).toFixed(0)}Hz`);
  }

  // 推定周波数でブザー検出→ペアリング検証
  const freqArg = Number(process.argv[3]);
  if (freqArg) {
    const buzzers = detectBuzzers(x, sr, { freq: freqArg });
    console.log(`detectBuzzers(freq=${freqArg}):`, buzzers.map((b) => `${b.time.toFixed(3)}s(${(b.dur * 1000).toFixed(0)}ms)`).join(', '));
    for (const gap of [3.0]) {
      const { pairs, unpaired } = pairBuzzers(buzzers, { gapSec: gap, tolSec: 0.4 });
      console.log(`pairBuzzers(gap=${gap}):`, JSON.stringify(pairs.map((p) => ({ start: +p.start.toFixed(3), end: +p.end.toFixed(3), gap: +(p.end - p.start).toFixed(3) }))), 'unpaired:', unpaired);
    }
  }
}
