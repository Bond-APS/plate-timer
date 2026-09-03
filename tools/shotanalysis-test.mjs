/* shotanalysis.js の単体検算。
   1) 純合成信号(ブザー様トーン+クリック)での精度検証
   2) 実クリップ3連結+既知オフセットのクリック重畳wav(ffmpegで生成)での検証
   使い方: node tools/shotanalysis-test.mjs [test3.wav]  */
import assert from 'node:assert';
import { analyzePlateRecording } from '../js/logic/shotanalysis.js';
import { readWavMono } from './analyze-clip.mjs';

const CLIP_META = { buzzerFreq: 200, buzzerGap: 3.0, buzzerMask: 0.3 };

/* ---------- 1) 純合成信号 ---------- */
{
  const sr = 16000;
  const dur = 32;
  const x = new Float32Array(sr * dur);
  for (let i = 0; i < x.length; i++) x[i] = (Math.random() * 2 - 1) * 0.003; // 室内ノイズ相当

  const tone = (t0) => { // ブザー: 200Hz+倍音、1.25秒、5msランプ
    const s = Math.round(t0 * sr), n = Math.round(1.25 * sr), ramp = Math.round(0.005 * sr);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let g = 1;
      if (i < ramp) g = i / ramp;
      if (i > n - ramp) g = (n - i) / ramp;
      x[s + i] += g * (0.3 * Math.sin(2 * Math.PI * 200 * t) + 0.1 * Math.sin(2 * Math.PI * 600 * t) + 0.05 * Math.sin(2 * Math.PI * 1000 * t));
    }
  };
  const click = (t0) => { // 発砲: 6msの広帯域バースト
    const s = Math.round(t0 * sr), n = Math.round(0.006 * sr);
    for (let i = 0; i < n; i++) x[s + i] += (Math.random() * 2 - 1) * 0.5 * (1 - i / n);
  };

  // 注: 反応2.95〜3.30秒は終了ブザーのオンセットマスク窓と重なるため測定不能(仕様上の制約)。
  // 超過ケースはマスク外の3.35秒でテストする
  const buzz1 = [2, 12, 22];
  const reactions = [0.9, 1.8, 3.35];
  for (let i = 0; i < 3; i++) {
    tone(buzz1[i]);
    tone(buzz1[i] + 3.0);
    click(buzz1[i] + reactions[i]);
  }

  const r = analyzePlateRecording(x, sr, CLIP_META);
  assert.equal(r.plates.length, 3, `合成: ブザー対3のはずが${r.plates.length}`);
  assert.equal(r.detected, 3, `合成: 発砲3のはずが${r.detected}`);
  r.plates.forEach((p, i) => {
    assert.ok(Math.abs(p.reaction - reactions[i]) <= 0.05,
      `合成: ${i + 1}枚目 反応${p.reaction?.toFixed(3)} 期待${reactions[i]}`);
  });
  assert.deepEqual(r.plates.map((p) => p.over), [false, false, true], '合成: 3秒超過フラグ');
  console.log('✓ 合成信号: 反応時間', r.plates.map((p) => p.reaction.toFixed(3)).join(', '), '(期待 0.9/1.8/3.35 ±0.05)');

  // ブザーのみ(発砲なし)→ 全枚未検出
  const y = new Float32Array(sr * 10);
  for (let i = 0; i < y.length; i++) y[i] = (Math.random() * 2 - 1) * 0.003;
  const t2 = (t0, f, d) => { const s = Math.round(t0 * sr), n = Math.round(d * sr);
    for (let i = 0; i < n; i++) y[s + i] += 0.3 * Math.sin(2 * Math.PI * f * i / sr); };
  t2(2, 200, 1.25); t2(5, 200, 1.25);
  const r2 = analyzePlateRecording(y, sr, CLIP_META);
  assert.equal(r2.plates.length, 1);
  assert.equal(r2.detected, 0, '発砲なし録音で誤検出');
  console.log('✓ 発砲なし: 誤検出ゼロ');

  // 無音 → ブザーなし警告
  const z = new Float32Array(sr * 5);
  const r3 = analyzePlateRecording(z, sr, CLIP_META);
  assert.equal(r3.plates.length, 0);
  assert.ok(r3.warnings.length > 0);
  console.log('✓ 無音: ブザーなし警告');
}

/* ---------- 2) 実クリップ合成wav(既知答え) ---------- */
if (process.argv[2]) {
  const { x, sr } = readWavMono(process.argv[2]);
  // ffmpeg生成時のクリック位置(真のブザー起点)。検出は約35ms遅れの系統誤差を持つ
  const expected = [0.8, 1.5, 3.4];
  const r = analyzePlateRecording(x, sr, CLIP_META);
  console.log('実クリップ合成:', JSON.stringify(r.plates.map((p) => ({ n: p.n, reaction: p.reaction != null ? +p.reaction.toFixed(3) : null, over: p.over }))), r.warnings);
  assert.equal(r.plates.length, 3, `実クリップ: ブザー対3のはずが${r.plates.length}`);
  assert.equal(r.detected, 3, `実クリップ: 発砲3のはずが${r.detected}`);
  r.plates.forEach((p, i) => {
    assert.ok(Math.abs(p.reaction - expected[i]) <= 0.07,
      `実クリップ: ${i + 1}枚目 反応${p.reaction?.toFixed(3)} 期待${expected[i]}`);
  });
  assert.deepEqual(r.plates.map((p) => p.over), [false, false, true]);
  console.log('✓ 実クリップ合成wav: 反応時間', r.plates.map((p) => p.reaction.toFixed(3)).join(', '), '(期待 0.80/1.50/3.40 ±0.07)');
}

console.log('全テストOK');
