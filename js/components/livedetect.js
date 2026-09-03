/* ライブ発砲音検出: Macのマイクで発砲音を拾い、開始ブザー→発砲の反応時間を測る。
   再生(audiotimer)と同一のAudioContextを使うため、ブザーの予約時刻とオンセット時刻の
   引き算だけで反応時間が出る。自前のブザー再生音は時刻既知なのでマスク窓で除外する。 */
import { CLIP } from '../logic/plateclip.js';
import { registerTimer, unregisterTimer } from './timer.js';

export class LiveShotDetector {
  constructor({ ctx, onShot }) {
    this.ctx = ctx;
    this.onShot = onShot;
    this.window = null;
    this.enabled = false;
    this.cancelled = false;
  }

  /* マイク許可+worklet配線。拒否・非対応時はthrow(呼び出し側でトースト)。
     許可プロンプト中にstop()された場合はマイクを即解放してfalseを返す */
  async enable() {
    this.cancelled = false;
    // getUserMediaはセキュアコンテキスト(https/localhost)でしか存在しない。
    // httpのURLで開いていると navigator.mediaDevices 自体が無い
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(window.isSecureContext
        ? 'このブラウザはマイク入力に対応していません'
        : 'httpsのURLで開き直してください(httpではマイクを使えません)');
    }
    registerTimer(this); // プロンプト中に画面遷移されてもstopAllTimers→stop()が届くよう先に登録
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        // 音声処理は全てOFF(エコキャン等はトランジェントを潰す)
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
      if (this.cancelled) { this._release(); return false; }
      await this.ctx.audioWorklet.addModule(new URL('./shot-worklet.js', import.meta.url).href);
      await this.ctx.resume();
      if (this.cancelled) { this._release(); return false; }
      this.src = this.ctx.createMediaStreamSource(this.stream);
      this.node = new AudioWorkletNode(this.ctx, 'shot-detector');
      this.mute = this.ctx.createGain();
      this.mute.gain.value = 0; // 出力には流さない(グラフ駆動用)
      this.src.connect(this.node).connect(this.mute).connect(this.ctx.destination);
      this.node.port.onmessage = (e) => { if (e.data?.type === 'onset') this._onOnset(e.data); };
      this.enabled = true;
      return true;
    } catch (err) {
      this._release(); // 途中まで取得したマイクを確実に解放
      throw err;
    }
  }

  /* AudioPlateTimer.onBuzzer から毎枚呼ぶ(AudioContext時刻) */
  setWindow({ plate, startTime, endTime }) {
    this.window = { plate, startTime, endTime, fired: false };
  }

  _onOnset({ time }) {
    const w = this.window;
    if (!w || w.fired) return;
    // 出力レイテンシ補正: ブザーが実際に空気中に出るのは予約時刻+outputLatency後。
    // Bluetoothスピーカー等では0.15〜0.3秒に達し、未補正だと3秒超過判定を汚染し、
    // 遅延したブザー音自体がマスク窓の外に出て偽の発砲として採用されてしまう
    const lat = this.ctx.outputLatency || this.ctx.baseLatency || 0;
    const start = w.startTime + lat;
    const end = w.endTime + lat;
    // 自前ブザー再生の立ち上がりを除外(鳴動中の発砲はworklet側の2kHzハイパスで拾える)
    const masked =
      (time > start - 0.05 && time < start + CLIP.buzzerMask) ||
      (time > end - 0.05 && time < end + CLIP.buzzerMask);
    if (masked) return;
    if (time < start + 0.1 || time > start + CLIP.buzzerGap + 0.5) return;
    w.fired = true;
    const reaction = time - start;
    this.onShot?.({ plate: w.plate, reaction, over: reaction > CLIP.buzzerGap });
  }

  _release() {
    this.enabled = false;
    try { this.src?.disconnect(); this.node?.disconnect(); this.mute?.disconnect(); } catch (e) { /* 切断済みは無視 */ }
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    unregisterTimer(this);
  }

  stop() {
    this.cancelled = true; // enable()のawait待ち中でも、再開時に確実に解放される
    this._release();
  }
}
