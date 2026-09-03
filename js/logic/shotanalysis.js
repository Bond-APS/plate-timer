/* 録音解析(発砲タイミング特定)の純関数群。Web Audio API非依存 — Nodeで検算できる。
   入力はモノラルFloat32Array(-1..1)とサンプルレート。 */

/* ---------- biquadフィルタ(RBJ Audio EQ Cookbook) ---------- */
function biquad(x, b0, b1, b2, a1, a2) {
  const y = new Float32Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[i]; y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}

/* バンドパス(ピーク0dB) */
export function biquadBandpass(x, sr, f0, q = 16) {
  const w = 2 * Math.PI * f0 / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cs = Math.cos(w);
  const a0 = 1 + alpha;
  return biquad(x, alpha / a0, 0, -alpha / a0, (-2 * cs) / a0, (1 - alpha) / a0);
}

export function biquadHighpass(x, sr, fc, q = 0.707) {
  const w = 2 * Math.PI * fc / sr;
  const alpha = Math.sin(w) / (2 * q);
  const cs = Math.cos(w);
  const a0 = 1 + alpha;
  return biquad(x, ((1 + cs) / 2) / a0, (-(1 + cs)) / a0, ((1 + cs) / 2) / a0, (-2 * cs) / a0, (1 - alpha) / a0);
}

/* ---------- RMSエンベロープ(dB) ---------- */
export function envelopeDb(x, sr, hopMs = 2, winMs = 5) {
  const hop = Math.max(1, Math.round(sr * hopMs / 1000));
  const win = Math.max(hop, Math.round(sr * winMs / 1000));
  const n = Math.max(0, Math.floor((x.length - win) / hop) + 1);
  const times = new Float32Array(n);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const off = i * hop;
    let sum = 0;
    for (let j = 0; j < win; j++) { const v = x[off + j]; sum += v * v; }
    times[i] = (off + win / 2) / sr;
    db[i] = 20 * Math.log10(Math.sqrt(sum / win) + 1e-9);
  }
  return { times, db };
}

/* ---------- オンセット検出(適応ノイズフロア+急峻な立ち上がり) ---------- */
export function detectOnsets(env, { thresholdDb = 12, riseDb = 8, riseMs = 10, refractoryMs = 150, floorTauSec = 1.0 } = {}) {
  const { times, db } = env;
  if (db.length < 2) return [];
  const dt = times[1] - times[0];
  const riseFrames = Math.max(1, Math.round((riseMs / 1000) / dt));
  const alpha = Math.min(1, dt / floorTauSec);
  let floor = Math.min(-45, db[0]);
  const onsets = [];
  let last = -Infinity;
  for (let i = 0; i < db.length; i++) {
    if (db[i] < floor + 6) floor += alpha * (db[i] - floor); // 静穏時のみフロア追従
    const rise = i >= riseFrames ? db[i] - db[i - riseFrames] : 0;
    if (db[i] > floor + thresholdDb && rise > riseDb && times[i] - last > refractoryMs / 1000) {
      onsets.push(times[i]);
      last = times[i];
    }
  }
  return onsets;
}

/* ---------- ブザー検出(狭帯域エネルギー優勢+持続長) ----------
   ブザー=クリップ実測周波数の持続音、発砲=広帯域インパルス、で分離する */
export function detectBuzzers(x, sr, { freq, q = 16, minDurMs = 150, domDb = -7, thresholdDb = 10, hopMs = 4, winMs = 10 } = {}) {
  const band = biquadBandpass(x, sr, freq, q);
  const be = envelopeDb(band, sr, hopMs, winMs);
  const we = envelopeDb(x, sr, hopMs, winMs);
  const n = Math.min(be.db.length, we.db.length);
  const dt = be.times.length > 1 ? be.times[1] - be.times[0] : hopMs / 1000;
  const alpha = Math.min(1, dt / 1.0);
  let floor = Math.min(-45, be.db[0] ?? -60);
  const active = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (be.db[i] < floor + 6) floor += alpha * (be.db[i] - floor);
    active[i] = be.db[i] > floor + thresholdDb && be.db[i] - we.db[i] > domDb ? 1 : 0;
  }
  // 短ギャップ(<30ms)を埋めて連結区間へ
  const gapFrames = Math.round(0.03 / dt);
  const out = [];
  let start = -1, lastActive = -1;
  for (let i = 0; i <= n; i++) {
    if (i < n && active[i]) {
      if (start < 0) start = i;
      lastActive = i;
    } else if (start >= 0 && (i - lastActive > gapFrames || i === n)) {
      const dur = be.times[lastActive] - be.times[start];
      if (dur * 1000 >= minDurMs) out.push({ time: be.times[start], dur });
      start = -1;
    }
  }
  return out;
}

/* ---------- 開始→終了ブザーのペアリング(間隔gapSec±tolSec、時刻順の貪欲法) ---------- */
export function pairBuzzers(buzzers, { gapSec = 3.0, tolSec = 0.2 } = {}) {
  const times = buzzers.map((b) => b.time);
  const pairs = [];
  const used = new Set();
  for (let i = 0; i < times.length; i++) {
    if (used.has(i)) continue;
    for (let j = i + 1; j < times.length; j++) {
      if (used.has(j)) continue;
      const d = times[j] - times[i];
      if (Math.abs(d - gapSec) <= tolSec) { pairs.push({ start: times[i], end: times[j] }); used.add(i); used.add(j); break; }
      if (d > gapSec + tolSec) break;
    }
  }
  return { pairs, unpaired: times.length - pairs.length * 2 };
}

/* ---------- 統合: 録音全体 → 枚ごとの反応時間 ----------
   clipMeta: { buzzerFreq, buzzerGap(開始→終了の実測秒), buzzerMask(オンセットマスク秒) }
   注: ブザーは1秒以上鳴り続け、発砲は鳴動中に起きる。発砲検出は2kHzハイパスで
   ブザー成分(基音200Hz+奇数次倍音≦1.8kHz)を除去するため、マスクはブザーの
   立ち上がりトランジェント付近だけでよい。 */
export function analyzePlateRecording(x, sr, clipMeta) {
  const warnings = [];
  // 実ブザーは持続1.2秒以上。コール音声の声(基音がbuzzerFreq近傍)による
  // 短い誤検出を持続長で弾く
  const buzzers = detectBuzzers(x, sr, { freq: clipMeta.buzzerFreq, minDurMs: clipMeta.buzzerMinDurMs ?? 700 });
  const { pairs, unpaired } = pairBuzzers(buzzers, { gapSec: clipMeta.buzzerGap, tolSec: 0.15 });
  if (!pairs.length) {
    return { plates: [], detected: 0, avg: null, min: null, max: null, warnings: ['ブザーが検出できませんでした。録音にタイマー音が入っているか、音量が小さすぎないか確認してください。'] };
  }
  if (unpaired > 0) warnings.push(`ペア化できないブザー様の音が${unpaired}件ありました(環境音の可能性)。`);
  if (pairs.length > 15) warnings.push(`${pairs.length}枚分のブザー対を検出しました。先頭15枚のみ表示します。`);

  // 発砲音: 高域トランジェント。ブザー直後の窓内の最初のオンセットを採用
  const hp = biquadHighpass(x, sr, 2000);
  const env = envelopeDb(hp, sr, 2, 5);
  const onsets = detectOnsets(env, { refractoryMs: 150 });
  const maskHalf = 0.05;
  const maskTail = clipMeta.buzzerMask ?? 0.3;

  const plates = pairs.slice(0, 15).map((p, i) => {
    const inMask = (t) =>
      (t > p.start - maskHalf && t < p.start + maskTail) ||
      (t > p.end - maskHalf && t < p.end + maskTail);
    const shot = onsets.find((t) => t >= p.start + 0.1 && t <= p.end + 0.5 && !inMask(t)) ?? null;
    const reaction = shot != null ? shot - p.start : null;
    return { n: i + 1, row: Math.floor(i / 5), startBuzzer: p.start, shot, reaction, over: reaction != null && reaction > 3.0 };
  });
  const rs = plates.map((p) => p.reaction).filter((r) => r != null);
  return {
    plates,
    detected: rs.length,
    avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
    min: rs.length ? Math.min(...rs) : null,
    max: rs.length ? Math.max(...rs) : null,
    warnings,
  };
}
