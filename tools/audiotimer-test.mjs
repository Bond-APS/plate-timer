/* audiotimer.js のAudioContext復旧まわりと、一時停止→再開の検算。
   ブラウザAPI(AudioContext/fetch)を偽物に差し替えて、
   「中断の検出 → 開始時の作り直し → 世代ごとの再デコード」と
   「一時停止→止めた場所から再開(予約のずらし直し)」が動くことを確かめる。
   使い方: node tools/audiotimer-test.mjs  */
const created = [];
class FakeCtx {
  constructor() {
    this.state = 'running';
    this.frozen = false; // 中断の再現: stateはrunningのまま時計だけ止まる
    this._t = 0;
    this._base = Date.now();
    this.sampleRate = 48000;
    this.destination = {};
    this.decodes = 0;
    this.sources = []; // 予約された音源(start/stopの引数を検証するため記録)
    created.push(this);
  }
  get currentTime() { return this.frozen ? this._t : (this._t = (Date.now() - this._base) / 1000); }
  setTime(t) { this.frozen = true; this._t = t; } // 音声クロックを手動で進める(検算用)
  async decodeAudioData(buf) { this.decodes++; return { ctx: this, duration: 8.661, byteLength: buf.byteLength }; }
  createGain() { return { gain: {}, connect() {} }; }
  createBuffer() { return {}; }
  createBufferSource() {
    const src = {
      buffer: null, startAt: null, offset: 0, stopped: false,
      connect() {}, start(t = 0, offset = 0) { this.startAt = t; this.offset = offset; }, stop() { this.stopped = true; },
    };
    this.sources.push(src);
    return src;
  }
  async resume() { if (!this.frozen) this.state = 'running'; }
  close() { this.state = 'closed'; }
}
globalThis.window = { AudioContext: FakeCtx };
globalThis.fetch = async (url) => ({
  ok: url.includes('plate-call'), // 審判録音(ref-*.m4a)は「ファイル無し」として扱う
  status: 404,
  arrayBuffer: async () => new ArrayBuffer(16),
});

const m = await import('../js/components/audiotimer.js');
let ng = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'NG  '} ${msg}`); if (!cond) ng++; };

const b1 = await m.loadPlateClip();
check(b1 === await m.loadPlateClip(), '同じ世代ならデコード結果を使い回す');
check(created.length === 1 && created[0].decodes === 1, 'コンテキストは1つ・デコードは1回');

created[0].frozen = true; // ← 画面ロックで中断された状態
check(await m.checkAudioCtxAlive(100) === false, '時計が止まったコンテキストを死んだと判定する');

const ctx2 = m.primeAudioCtx(); // ←「開始」ボタンのクリック同期部分
check(ctx2 !== created[0], '開始時に新しいコンテキストを作る');
check(created[0].state === 'closed', '古いコンテキストは閉じる');
const b3 = await m.loadPlateClip();
check(b3 !== b1 && b3.ctx === ctx2, '新しい世代で音源を再デコードする');
check(b3.byteLength === 16, 'fetchしたバイト列を使い回せている(detach対策のslice)');
check(await m.checkAudioCtxAlive(60) === true, '作り直したコンテキストは生きている');

check(m.primeAudioCtx() === ctx2, '健全なら作り直さない(マイク計測が維持される)');
check(await m.loadPlateClip() === b3, '作り直しが無ければ再デコードしない');

ctx2.state = 'suspended'; // ← 中断で suspended になった場合
ctx2.onstatechange?.();
check(m.primeAudioCtx() !== ctx2, '中断(suspended)を観測したら作り直す');

const voices = await m.loadRefVoices();
check(voices.opening === null && voices.break === null && voices.finish === null, '審判録音が無ければ全スロットnull');

/* ---------- 一時停止 → 止めた場所から再開 ----------
   ここから下は同期処理だけで進める(await を挟むと _tick() のsetTimeoutが割り込む) */
const ctx = m.getAudioCtx();
const buffer = await m.loadPlateClip();
const seenBuzzers = [];
ctx.setTime(100); // 音声クロックを手動で持つ
ctx.sources.length = 0;
const t = new m.AudioPlateTimer({
  buffer, count: 15, startDelay: 5, interval: 10, rowGap: 12,
  onState: () => {}, onBuzzer: (b) => seenBuzzers.push(b),
});
t.start();
const call1 = t.schedule[0].t0;
const gap = t.schedule[1].t0 - call1;
check(call1 === 105, '開始遅延(5秒)どおりに1枚目のコールを予約する');
check(ctx.sources.length === 15, '15枚ぶんのクリップを一括予約する');

ctx.setTime(call1 + 2); // 1枚目のコール中(開始ブザーの前)に一時停止
const buzzersBefore = seenBuzzers.length;
check(t.pause() === true, '実行中は一時停止できる');
check(t.pause() === false, '一時停止の二重押しは何もしない');
check(t.running === false && t.paused === true, '一時停止中は running=false / paused=true');
check(ctx.sources.every((s) => s.stopped), '予約済みの音源をすべて止める');
check(t.planned.length === 15, '予定表は消さずに残す(再開で使う)');

ctx.setTime(call1 + 2 + 30); // 30秒放置してから再開
ctx.sources.length = 0;
check(t.resume() === true, '一時停止中は再開できる');
check(t.resume() === false, '実行中に再開を押しても何もしない');
check(t.running === true && t.paused === false, '再開で実行中に戻る');
const at = call1 + 32 + 0.25; // 再開の予約時刻(RESUME_LEAD=0.25秒)
const near = (a, b) => Math.abs(a - b) < 1e-6;
const mid = ctx.sources.find((s) => s.offset > 0);
check(ctx.sources.length === 15, '残り全部(途中だった1枚目+未再生14枚)を予約し直す');
check(!!mid && near(mid.offset, 2), '鳴っていたクリップを止めた位置(2.00秒)から続ける');
check(mid.startAt === at, '再開の0.25秒後から鳴り出す');
check(near(t.schedule[0].t0, at - 2), '1枚目の基準時刻を止めていた分だけ後ろへずらす');
check(near(t.schedule[1].t0 - t.schedule[0].t0, gap), 'インターバル(ランダム加算込み)は作り直さない');
const nextSrc = ctx.sources.find((s) => s.offset === 0 && s.startAt > at);
check(!!nextSrc && near(nextSrc.startAt, t.schedule[1].t0), '未再生のクリップは ずらした時刻で予約し直す');
check(seenBuzzers.length === buzzersBefore + 1, '開始ブザーがまだ先なら検出の時間窓を取り直す');
check(seenBuzzers.at(-1).plate === 1 && near(seenBuzzers.at(-1).startTime, t.schedule[0].t0 + 4.31),
  '取り直した時間窓は ずらした開始ブザー時刻');

ctx.setTime(t.schedule[0].t0 + 8.661 + 3); // 1枚目が鳴り終わったインターバル中に一時停止
t.pause();
ctx.setTime(ctx.currentTime + 20);
ctx.sources.length = 0;
t.resume();
check(ctx.sources.length === 14 && ctx.sources.every((s) => s.offset === 0),
  '鳴り終わったクリップは鳴らし直さない(残り14枚を頭から予約)');
t.stop();
check(t.paused === false && t.planned.length === 0, '停止で一時停止の状態も片付ける');

console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
