/* audiotimer.js のAudioContext復旧まわりの検算(iPhoneの画面ロック中断の再現)。
   ブラウザAPI(AudioContext/fetch)を偽物に差し替えて、
   「中断の検出 → 開始時の作り直し → 世代ごとの再デコード」が動くことを確かめる。
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
    created.push(this);
  }
  get currentTime() { return this.frozen ? this._t : (this._t = (Date.now() - this._base) / 1000); }
  async decodeAudioData(buf) { this.decodes++; return { ctx: this, duration: 8.661, byteLength: buf.byteLength }; }
  createGain() { return { gain: {}, connect() {} }; }
  createBuffer() { return {}; }
  createBufferSource() { return { connect() {}, start() {}, stop() {} }; }
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

console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
