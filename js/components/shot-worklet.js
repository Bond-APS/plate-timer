/* 発砲音オンセット検出 AudioWorkletProcessor(自己完結・importなし)。
   2kHzハイパス(バイカッド2段)で低域を落とし、ブロックRMSのdB値に対して
   適応ノイズフロア+急峻な立ち上がりで「候補」を拾う。
   候補は150ms後に「衝撃音(発砲)」か「持続音(ブザー)」かを分類してから通知する:
     - onset     … 立ち上がり後に減衰した(発砲)。time は立ち上がり時刻
     - sustained … 立ち上がり後も鳴り続けた(タイマーのブザー。実際に聞こえた時刻の校正に使う)
   分類が要る理由(v1.2): 端末によってはブザーの2kHz超の成分が大きく、再生遅延が正しく
   報告されない(Android Chrome等)と、遅れて届いたブザーが除外窓の外に出て発砲と誤認される。
   持続時間で見分ければ遅延量に依らず弾ける。
   どのオンセットを発砲として採用するかの時間窓ゲートはメインスレッド(livedetect.js)が行う。 */

class ShotDetectorProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    // 2次バターワースHPF(fc=2kHz)を2段直列(-24dB/oct)
    const w = 2 * Math.PI * 2000 / sampleRate;
    const alpha = Math.sin(w) / (2 * 0.707);
    const cs = Math.cos(w);
    const a0 = 1 + alpha;
    this.c = {
      b0: ((1 + cs) / 2) / a0, b1: (-(1 + cs)) / a0, b2: ((1 + cs) / 2) / a0,
      a1: (-2 * cs) / a0, a2: (1 - alpha) / a0,
    };
    this.s1 = { x1: 0, x2: 0, y1: 0, y2: 0 };
    this.s2 = { x1: 0, x2: 0, y1: 0, y2: 0 };
    const blockSec = 128 / sampleRate;
    this.riseLen = Math.max(2, Math.round(0.010 / blockSec)); // 立ち上がり判定: 約10ms前と比較
    this.preLen = Math.max(this.riseLen + 1, Math.round(0.100 / blockSec)); // 直前100msの最大値(持続音の中の揺れを弾く)
    this.hist = new Array(this.preLen).fill(-100); // 直近 preLen ブロックのdB(古い→新しい)
    this.floor = -60;
    this.floorAlpha = blockSec / 1.0; // 時定数約1秒
    this.lastCand = -10;
    this.pending = null; // 分類待ちの候補 {time, peak, pre, until}
    this.peakHold = Math.round(0.030 / blockSec);  // ピーク追跡 30ms
    this.classifyAt = Math.round(0.150 / blockSec); // 150ms後に分類
  }

  _biquad(st, x) {
    const c = this.c;
    const y = c.b0 * x + c.b1 * st.x1 + c.b2 * st.x2 - c.a1 * st.y1 - c.a2 * st.y2;
    st.x2 = st.x1; st.x1 = x; st.y2 = st.y1; st.y1 = y;
    return y;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      const v = this._biquad(this.s2, this._biquad(this.s1, ch[i]));
      sum += v * v;
    }
    const db = 20 * Math.log10(Math.sqrt(sum / ch.length) + 1e-9);
    const h = this.hist;
    const prev = h[h.length - this.riseLen]; // 約10ms前
    let preMax = -100; // 10ms前より前〜100ms前の最大(=候補の前の地合い)
    for (let i = 0; i < h.length - this.riseLen; i++) if (h[i] > preMax) preMax = h[i];

    // 分類待ちの候補: ピークを30ms追い、150ms後に減衰の有無で分ける
    if (this.pending) {
      const p = this.pending;
      p.elapsed += 1;
      if (p.elapsed <= this.peakHold && db > p.peak) p.peak = db;
      if (p.elapsed >= this.classifyAt) {
        // 持続音: ピークからほとんど減衰せず、かつ候補前の地合いより明らかに大きいまま
        const sustained = (p.peak - db) < 8 && db > p.pre + 6;
        this.port.postMessage({ type: sustained ? 'sustained' : 'onset', time: p.time, db: p.peak, post: db, pre: p.pre });
        this.pending = null;
      }
    }

    if (db < this.floor + 6) this.floor += this.floorAlpha * (db - this.floor); // 静穏時のみ追従
    const rise = db - prev;
    if (!this.pending && db > this.floor + 12 && rise > 8 && db > preMax + 6 && currentTime - this.lastCand > 0.25) {
      this.lastCand = currentTime;
      this.pending = { time: currentTime, peak: db, pre: preMax, elapsed: 0 };
    }
    h.push(db);
    h.shift();
    return true;
  }
}

registerProcessor('shot-detector', ShotDetectorProcessor);
