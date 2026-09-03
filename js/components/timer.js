/* 合成音プレートタイマー(実音声クリップが読めないときのフォールバック)と、動作中タイマーの登録簿 */

/* 動作中タイマーの登録簿: 画面遷移時に app.js が stopAllTimers() で一括停止する。
   audiotimer.js / livedetect.js も stop() を持つオブジェクトをここに登録する */
const activeTimers = new Set();
export function stopAllTimers() {
  for (const t of activeTimers) t.stop();
  activeTimers.clear();
}
export function registerTimer(t) { activeTimers.add(t); }
export function unregisterTimer(t) { activeTimers.delete(t); }

class Beeper {
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }
  beep(freq, dur, gain = 0.22) {
    this.ensure();
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  double(freq, dur = 0.12) {
    this.beep(freq, dur);
    setTimeout(() => this.beep(freq, dur), 180);
  }
}
export const beeper = new Beeper();

/*
 * プレートタイマー: 各プレート「開始ブザー(低)→3.0秒→終了ブザー(高)→インターバル」。
 * 5枚ごと(段終わり)にポーズし resumeRow() 待ち。
 * cb: onState({phase:'shoot'|'interval'|'rowEnd'|'done', plate, row, remain, total})
 */
export class PlateTimer {
  constructor({ count = 15, interval = 7, shootSec = 3.0, onState }) {
    this.count = count;
    this.interval = interval;
    this.shootSec = shootSec;
    this.onState = onState;
    this.timers = [];
    this.plate = 0;
    this.running = false;
  }
  _after(sec, fn) { this.timers.push(setTimeout(fn, sec * 1000)); }
  _tickUntil(deadline, phase) {
    const tick = () => {
      if (!this.running) return;
      const remain = Math.max(0, (deadline - performance.now()) / 1000);
      this.onState({ phase, plate: this.plate, row: Math.floor((this.plate - 1) / 5), remain, total: phase === 'shoot' ? this.shootSec : this.interval });
      if (remain > 0) this.timers.push(setTimeout(tick, 50));
    };
    tick();
  }
  start() {
    beeper.ensure();
    this.running = true;
    this.plate = 0;
    activeTimers.add(this);
    this._next();
  }
  _next() {
    if (!this.running) return;
    this.plate++;
    if (this.plate > this.count) {
      this.running = false;
      beeper.double(1046, 0.18);
      this.onState({ phase: 'done', plate: this.count, row: 2, remain: 0, total: 0 });
      return;
    }
    beeper.beep(440, 0.15); // 開始ブザー(振り上げ)
    const deadline = performance.now() + this.shootSec * 1000;
    this._tickUntil(deadline, 'shoot');
    this._after(this.shootSec, () => {
      if (!this.running) return;
      beeper.beep(880, 0.3); // 終了ブザー
      const isRowEnd = this.plate % 5 === 0 && this.plate < this.count;
      if (isRowEnd) {
        this.onState({ phase: 'rowEnd', plate: this.plate, row: Math.floor((this.plate - 1) / 5), remain: 0, total: 0 });
        beeper.double(660);
      } else {
        const d2 = performance.now() + this.interval * 1000;
        this._tickUntil(d2, 'interval');
        this._after(this.interval, () => this._next());
      }
    });
  }
  resumeRow() {
    if (!this.running) return;
    const d = performance.now() + this.interval * 1000;
    this._tickUntil(d, 'interval');
    this._after(this.interval, () => this._next());
  }
  stop() {
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    activeTimers.delete(this);
  }
}

export function fmtSec(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
