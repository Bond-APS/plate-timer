/* 発砲音オンセット検出 AudioWorkletProcessor(自己完結・importなし)。
   2kHzハイパス(バイカッド2段)でタイマーブザー成分(基音200Hz+倍音≦1.8kHz)を除去し、
   ブロックRMSのdB値に対して適応ノイズフロア+急峻な立ち上がりでオンセットを検出する。
   検出時刻(AudioContext時刻)を postMessage({type:'onset', time, db}) で通知。
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
    this.hist = [];          // 直近ブロックのdB履歴(立ち上がり判定用)
    this.histLen = Math.max(2, Math.round(0.010 * sampleRate / 128)); // 約10ms
    this.floor = -60;
    this.floorAlpha = 128 / sampleRate / 1.0; // 時定数約1秒
    this.lastOnset = -10;
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
    const prev = this.hist.length >= this.histLen ? this.hist[0] : null;
    this.hist.push(db);
    if (this.hist.length > this.histLen) this.hist.shift();

    if (db < this.floor + 6) this.floor += this.floorAlpha * (db - this.floor); // 静穏時のみ追従
    const rise = prev != null ? db - prev : 0;
    if (db > this.floor + 12 && rise > 8 && currentTime - this.lastOnset > 0.25) {
      this.lastOnset = currentTime;
      this.port.postMessage({ type: 'onset', time: currentTime, db });
    }
    return true;
  }
}

registerProcessor('shot-detector', ShotDetectorProcessor);
