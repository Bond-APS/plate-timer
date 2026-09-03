/* 実音声プレートタイマー: 競技実音声クリップ(コール→開始ブザー→3秒→終了ブザー)を
   1枚ごとに繰り返し再生する。開始時(またはパート移動時)に残り全パートの音源を
   AudioBufferSourceNodeで一括予約(音声クロック)するため、タブのスロットリングや
   iPhoneの画面ロックでJSが止まっても音声は最後まで鳴る。音源が読めない場合は
   合成音PlateTimerへフォールバックする。
   オーディオセッションがロックで切れた場合は、復帰後の最初のtickで音声クロックの
   停止を検出して 'interrupted' を通知し、次の「開始」で primeAudioCtx() が
   AudioContextごと作り直す(作り直しはユーザー操作の同期中でないとiOSが鳴らさない)。
   審判録音(任意・public/audio/ref-*.m4a の固定ファイル): 冒頭(開始前)・段の間(2回)・
   15枚終了1秒後 に差し込む。ファイルが無いスロットは黙ってスキップする。 */
import { CLIP } from '../logic/plateclip.js';
import { PlateTimer, registerTimer, unregisterTimer } from './timer.js';

/* 再生とマイク検出で共有するAudioContext(同一タイムベースにするため1つだけ)。
   iPhoneは画面ロックでオーディオセッションが中断され、復帰後も state が 'running' の
   まま音が出ない(音声クロックが止まったまま)状態になることがある。この状態は
   resume() では戻らないので作り直すしかない。作り直すたびに世代番号(ctxGeneration)を進め、
   デコード済みAudioBufferも世代ごとに作り直す(WebKitでは閉じたコンテキストで
   デコードしたバッファを別コンテキストで鳴らすと無音になることがあるため)。 */
let sharedCtx = null;
let ctxGeneration = 0;
let ctxUnhealthy = false;  // 中断を観測した。次のユーザー操作で作り直す
let ctxWasRunning = false; // 一度でも running になったか(初回のsuspendedと中断後のsuspendedを区別する)

function newAudioCtx() {
  sharedCtx = new (window.AudioContext || window.webkitAudioContext)();
  ctxGeneration += 1;
  ctxWasRunning = sharedCtx.state === 'running';
  sharedCtx.onstatechange = () => {
    const st = sharedCtx?.state;
    if (st === 'running') ctxWasRunning = true;
    else if (ctxWasRunning && st !== 'closed') ctxUnhealthy = true; // interrupted / suspended = 中断された
  };
  return sharedCtx;
}

export function getAudioCtx() {
  if (!sharedCtx || sharedCtx.state === 'closed') return newAudioCtx();
  return sharedCtx;
}

export function audioCtxGeneration() { return ctxGeneration; }

export function hasAudioCtx() { return !!sharedCtx; } // 未作成なら触らない(不要な生成を避ける)

/* ユーザー操作(クリック)の同期部分で呼ぶ。中断を観測していればコンテキストを作り直し、
   無音1サンプルを鳴らして出力を開通させる。await を挟むとiOSが再生を拒否することが
   あるため、ここは同期のまま完結させる(デコードは呼び出し側で await してよい) */
export function primeAudioCtx() {
  let ctx = getAudioCtx();
  const broken = ctxUnhealthy || ctx.state === 'interrupted' || (ctx.state === 'suspended' && ctxWasRunning);
  if (broken) {
    try { ctx.close(); } catch (e) { /* 既にclosedなら無視 */ }
    sharedCtx = null;
    ctx = newAudioCtx();
  }
  ctxUnhealthy = false;
  try { ctx.resume(); } catch (e) { /* 下の無音再生で開通することがあるので続行 */ }
  try {
    const s = ctx.createBufferSource(); // 無音1サンプル: iOSの出力経路をユーザー操作中に開通させる
    s.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    s.connect(ctx.destination);
    s.start();
  } catch (e) { /* 解錠に失敗しても本編の予約は試す */ }
  return ctx;
}

/* 音が本当に出る状態かを実時間で確かめる。中断後は state が 'running' のままでも
   音声クロックが進まないので、進み方で判定する。止まっていれば作り直し対象に印を付ける */
export async function checkAudioCtxAlive(ms = 400) {
  if (!sharedCtx) return true; // まだ作っていない = 壊れようがない
  const ctx = sharedCtx;
  if (ctx.state !== 'running') {
    if (ctxWasRunning) ctxUnhealthy = true;
    return false;
  }
  const t0 = ctx.currentTime;
  await new Promise((r) => setTimeout(r, ms));
  if (sharedCtx !== ctx) return false; // 待っている間に作り直された
  const alive = ctx.currentTime - t0 > (ms / 1000) * 0.5;
  if (!alive) ctxUnhealthy = true;
  return alive;
}

export function markAudioCtxUnhealthy() { ctxUnhealthy = true; }

/* 音源のバイト列(fetch結果)は世代をまたいで使い回し、デコードだけ世代ごとにやり直す。
   decodeAudioData は渡したArrayBufferをdetachするので、必ずコピー(slice)を渡すこと */
let clipBytes = null;
function loadClipBytes() {
  if (!clipBytes) {
    clipBytes = (async () => {
      const res = await fetch(CLIP.url);
      if (!res.ok) throw new Error(`音源の取得に失敗 (${res.status})`);
      return await res.arrayBuffer();
    })().catch((err) => { clipBytes = null; throw err; }); // 失敗時は次回再試行できるように
  }
  return clipBytes;
}

let clipCache = { gen: -1, promise: null };
export function loadPlateClip() {
  getAudioCtx(); // 先にコンテキストを作って世代を確定させてからキャッシュを引く
  if (clipCache.gen !== ctxGeneration) {
    const gen = ctxGeneration;
    const promise = (async () => {
      const bytes = await loadClipBytes();
      return await getAudioCtx().decodeAudioData(bytes.slice(0));
    })().catch((err) => { if (clipCache.gen === gen) clipCache = { gen: -1, promise: null }; throw err; });
    clipCache = { gen, promise };
  }
  return clipCache.promise;
}

/* 審判録音(3スロット)。ファイルが無い・デコード不能なスロットはnull */
export const REF_SLOTS = [
  { slot: 'opening', label: '冒頭(開始前)' },
  { slot: 'break', label: '段の間' },
  { slot: 'finish', label: '終了1秒後' },
];
/* 音声セット: 'referee'(審判の実録音 audio/ref-*.m4a) / 'ai-male' / 'ai-female'(audio/<set>/ref-*.m4a)。
   選んだセットにファイルが無いスロットは審判音声に戻る。切り替えたらバイト列キャッシュを捨てて次回読み直す */
export const VOICE_SETS = ['referee', 'ai-male', 'ai-female'];
let voiceSet = 'referee';
export function setVoiceSet(name) {
  const next = VOICE_SETS.includes(name) ? name : 'referee';
  if (next === voiceSet) return;
  voiceSet = next;
  refBytes = null;
  refCache = { gen: -1, promise: null };
}
export function getVoiceSet() { return voiceSet; }
function refUrl(set, slot) {
  return new URL(set === 'referee' ? `../../audio/ref-${slot}.m4a` : `../../audio/${set}/ref-${slot}.m4a`, import.meta.url).href;
}
async function fetchBytes(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch (e) { return null; } // ファイル無しは「音声なし」として扱う
}
let refBytes = null;
function loadRefBytes() {
  if (!refBytes) {
    const set = voiceSet;
    refBytes = Promise.all(REF_SLOTS.map(async ({ slot }) => {
      const own = await fetchBytes(refUrl(set, slot));
      if (own || set === 'referee') return own;
      return await fetchBytes(refUrl('referee', slot)); // AI音声が無いスロットは審判音声で補う
    }));
  }
  return refBytes;
}

let refCache = { gen: -1, promise: null };
export function loadRefVoices() {
  getAudioCtx(); // 先にコンテキストを作って世代を確定させてからキャッシュを引く
  if (refCache.gen !== ctxGeneration) {
    const gen = ctxGeneration;
    const promise = (async () => {
      const list = await loadRefBytes();
      const ctx = getAudioCtx();
      const decoded = await Promise.all(list.map(async (bytes) => {
        if (!bytes) return null;
        try { return await ctx.decodeAudioData(bytes.slice(0)); } catch (e) { return null; } // デコード不能も「音声なし」
      }));
      return { opening: decoded[0], break: decoded[1], finish: decoded[2] };
    })().catch(() => ({ opening: null, break: null, finish: null }));
    refCache = { gen, promise };
  }
  return refCache.promise;
}

/*
 * onState({phase:'call'|'shoot'|'interval'|'done'|'interrupted', sub, plate, row, remain, total})
 *   - 'interrupted' は画面ロック等で音声が切れたときの通知(タイマーは自分で止まる)
 *   - 'call' はコール〜開始ブザーまでの構え相(合成音タイマーには無い)
 *   - 'interval' の sub でインターバルの種類を区別する:
 *     'begin'=冒頭録音〜最初のコール / 'first'=このコールまでの待ち(開始遅延・パート移動直後) /
 *     'next'=同じ段の次の枚へ / 'row'=段の継ぎ目 / 'end'=最終枚の鳴り終わり〜終了録音
 * onBuzzer({plate, startTime, endTime}) … AudioContext時刻。ライブ検出の時間窓に使う
 * startDelay:   開始ボタン→最初の音声までの秒(冒頭録音がある場合は使わず、録音終了→2秒固定で最初のコール)
 * interval:     クリップ(音声)の終わりから次のクリップ開始までの秒(同じ段の中)
 * randomMax:    >0なら同段のintervalに 0〜randomMax 秒をランダム加算(タイミングの先読み防止)
 * rowGap:       段の継ぎ目(5枚ごと)のインターバル秒(intervalとは独立の値)
 * rowRandomMax: >0なら段の継ぎ目に 0〜rowRandomMax 秒をランダム加算
 * voices:       {opening, break, finish} 審判録音のAudioBuffer(無いスロットはnull)
 *   - opening: 開始ボタンの直後に再生し、終わってから2秒固定で最初のコール
 *   - break:   段の継ぎ目で rowGap+ランダム 経過後に再生し、終わってから2秒後に次のコール
 *   - finish:  15枚目のクリップが鳴り終わった1秒後に再生
 */
const STALL_SEC = 1.0; // 音声クロックがこの秒数進まなければ中断とみなす
const VOICE_GAP = 2.0; // 審判録音(冒頭・段間)の終わり→次のコールまでの固定秒
const CLIP_GAIN = 0.5; // 「プレート・スタンバイ・レディー」クリップの再生音量(審判録音より大きいため下げる。録音は等倍)
// 審判録音は -15 LUFS へラウドネス正規化済み(ffmpeg loudnorm)。
// クリップは -10.4 LUFS なので 0.5倍(-6dB) で実効 -16.4 LUFS となり録音(-15.3〜-16.3)と揃う。

/* 音量バランス(設定画面から変更可)。既定は上の実測バランスそのもの。
   clip=コールクリップの倍率(既定0.5)、voice=審判録音の倍率(既定1.0)。次の「開始」から反映 */
const gains = { clip: CLIP_GAIN, voice: 1.0 };
export const DEFAULT_GAINS = { clip: CLIP_GAIN, voice: 1.0 };
export function setGains({ clip, voice } = {}) {
  if (Number.isFinite(clip)) gains.clip = Math.max(0, Math.min(2, clip));
  if (Number.isFinite(voice)) gains.voice = Math.max(0, Math.min(2, voice));
}

export class AudioPlateTimer {
  constructor({ buffer, count = 15, startDelay = 10, interval = 12, rowGap = 14, randomMax = 0, rowRandomMax = 0, voices = {}, onState, onBuzzer }) {
    this.buffer = buffer;
    this.count = count;
    this.startDelay = Math.max(0.15, startDelay);
    this.interval = Math.max(0, interval);
    this.rowGap = Math.max(0, rowGap);
    this.randomMax = Math.max(0, randomMax);
    this.rowRandomMax = Math.max(0, rowRandomMax);
    this.voices = voices;
    this.onState = onState;
    this.onBuzzer = onBuzzer;
    this.ctx = getAudioCtx();
    this.clipGain = this.ctx.createGain();
    this.clipGain.gain.value = gains.clip;
    this.clipGain.connect(this.ctx.destination);
    this.voiceGain = this.ctx.createGain(); // 審判録音用(既定は等倍)
    this.voiceGain.gain.value = gains.voice;
    this.voiceGain.connect(this.ctx.destination);
    this.sources = [];
    this.tickTimer = null;
    this.running = false;
  }

  start() {
    this.ctx.resume();
    this.running = true;
    registerTimer(this);
    this._build(1, true);
    this._tick();
  }

  /* startPlate〜最終枚までの全クリップ+審判録音を一括予約し、進行表(schedule)を作る。
     withOpening=true なら冒頭パート(冒頭録音 or 開始遅延)を先頭に置く */
  _build(startPlate, withOpening) {
    const now = this.ctx.currentTime;
    let t;
    if (withOpening) {
      if (this.voices.opening) {
        const tOpen = now + 0.2;
        this._scheduleSource(tOpen, this.voices.opening);
        t = tOpen + this.voices.opening.duration + VOICE_GAP;
      } else {
        t = now + this.startDelay;
      }
    } else {
      t = now + 0.3; // パート移動: すぐコールへ
    }
    this.openingUntil = withOpening ? t : 0;
    this.initialWait = t - now; // 最初のコールまでの待ち(リング表示用)
    this.schedule = [];
    for (let n = startPlate; n <= this.count; n++) {
      this._scheduleSource(t);
      this.schedule.push({ plate: n, t0: t });
      if (n < this.count) {
        // 段の継ぎ目は rowGap+ランダム 経過後に審判録音(break)を鳴らし、その終了の2秒後に次のコール
        let next = t + CLIP.duration + this._gap(n % 5 === 0);
        if (n % 5 === 0 && this.voices.break) {
          this._scheduleSource(next, this.voices.break);
          next += this.voices.break.duration + VOICE_GAP;
        }
        t = next;
      } else {
        // 最終枚: クリップが鳴り終わるまで待ち、終了録音(finish)があれば1秒後に再生
        this.endAt = t + CLIP.duration;
        if (this.voices.finish) {
          const tFin = this.endAt + 1.0;
          this._scheduleSource(tFin, this.voices.finish);
          this.endAt = tFin + this.voices.finish.duration;
        }
      }
    }
    this._setCurrent(0);
  }

  _setCurrent(i) {
    this.idx = i;
    const cur = this.schedule[i];
    this.plate = cur.plate;
    this.t0 = cur.t0;
    this.nextT0 = this.schedule[i + 1]?.t0 ?? null;
    this.onBuzzer?.({ plate: cur.plate, startTime: cur.t0 + CLIP.startBuzzer, endTime: cur.t0 + CLIP.endBuzzer });
  }

  _scheduleSource(t, buffer = this.buffer) {
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(buffer === this.buffer ? this.clipGain : this.voiceGain);
    src.start(t);
    this.sources.push(src);
  }

  _gap(isRowEnd) {
    return isRowEnd
      ? this.rowGap + (this.rowRandomMax > 0 ? Math.random() * this.rowRandomMax : 0)
      : this.interval + (this.randomMax > 0 ? Math.random() * this.randomMax : 0);
  }

  _emit(phase, remain, total, sub) {
    this.onState?.({ phase, sub, plate: this.plate, row: Math.floor((this.plate - 1) / 5), remain, total });
  }

  /* 音声クロックが1秒以上進まなければ「中断された」と判定する。
     ロック中はJSも止まるので復帰後の最初のtickで、ロック中もJSが動く場合は
     その場で気づける(音が鳴り続けているならクロックは実時間どおり進む) */
  _interrupted() {
    const wall = performance.now() / 1000;
    const audio = this.ctx.currentTime;
    if (this.lastAudio == null || audio > this.lastAudio + 0.001) {
      this.lastAudio = audio;
      this.lastAdvance = wall; // 最後にクロックが進んでいた実時刻
      return false;
    }
    return wall - this.lastAdvance > STALL_SEC;
  }

  _tick() {
    if (!this.running) return;
    if (this._interrupted()) {
      // ロック中断でオーディオセッションが切れた。予約済みの音は失われているので、
      // ここで畳んで作り直しの印を付ける(次の「開始」でコンテキストごと作り直される)
      markAudioCtxUnhealthy();
      this.running = false;
      clearTimeout(this.tickTimer);
      this._cancelScheduled();
      unregisterTimer(this);
      this._emit('interrupted', 0, 0);
      return;
    }
    const rel = this.ctx.currentTime - this.t0;
    if (rel < 0) {
      // このパートのコールまでの待ち。冒頭パートなら「サイティング練習」表示(begin)
      this._emit('interval', -rel, this.initialWait,
        this.ctx.currentTime < this.openingUntil && this.voices.opening ? 'begin' : 'first');
    } else if (rel < CLIP.startBuzzer) {
      this._emit('call', CLIP.startBuzzer - rel, CLIP.startBuzzer);
    } else if (rel < CLIP.endBuzzer) {
      this._emit('shoot', CLIP.endBuzzer - rel, CLIP.buzzerGap);
    } else if (this.nextT0 != null) {
      const toNext = this.nextT0 - this.ctx.currentTime;
      if (toNext <= 0) {
        this._setCurrent(this.idx + 1);
      } else {
        this._emit('interval', toNext, this.nextT0 - this.t0 - CLIP.endBuzzer, this.plate % 5 === 0 ? 'row' : 'next');
      }
    } else if (this.ctx.currentTime < this.endAt) {
      this._emit('interval', this.endAt - this.ctx.currentTime, this.endAt - this.t0 - CLIP.endBuzzer, 'end');
    } else {
      this.running = false;
      unregisterTimer(this);
      this._emit('done', 0, 0);
      return;
    }
    this.tickTimer = setTimeout(() => this._tick(), 50);
  }

  stop() {
    this.running = false;
    this.lastAudio = null;
    this.lastAdvance = null;
    clearTimeout(this.tickTimer);
    this._cancelScheduled();
    unregisterTimer(this);
  }

  /* ---------- パート移動(|◀ / ▶|) ----------
     パート = 冒頭(サイティング練習) → 1〜15枚目(コール〜射撃〜後続インターバル) → 終了。
     予約済みの音源をすべて止めてから、目的のパート以降を予約し直す。 */

  _cancelScheduled() {
    for (const s of this.sources) { try { s.stop(); } catch (e) { /* 未開始/停止済みは無視 */ } }
    this.sources = [];
  }

  _jumpToPlate(n) {
    this._cancelScheduled();
    this._build(n, false);
  }

  _jumpToOpening() {
    this._cancelScheduled();
    this._build(1, true);
  }

  _jumpToEnd() {
    this._cancelScheduled();
    const now = this.ctx.currentTime;
    this.schedule = [{ plate: this.count, t0: now - CLIP.duration }]; // 相対位置を「最終枚の鳴り終わり」に置く
    this.idx = 0;
    this.plate = this.count;
    this.t0 = now - CLIP.duration;
    this.nextT0 = null;
    this.openingUntil = 0;
    this.endAt = now;
    if (this.voices.finish) {
      const tFin = now + 0.3;
      this._scheduleSource(tFin, this.voices.finish);
      this.endAt = tFin + this.voices.finish.duration;
    }
  }

  skipNext() {
    if (!this.running) return;
    if (this.ctx.currentTime < this.openingUntil) this._jumpToPlate(1); // 冒頭パート中 → 1枚目へ
    else if (this.plate < this.count) this._jumpToPlate(this.plate + 1);
    else this._jumpToEnd();
  }

  skipPrev() {
    if (!this.running) return;
    if (this.ctx.currentTime < this.openingUntil) { this._jumpToOpening(); return; } // 冒頭パート中 → 冒頭の頭へ
    const rel = this.ctx.currentTime - this.t0;
    // コール開始から3秒以内なら前のパートへ、それ以降なら今のパートの頭へ(音楽プレイヤーと同じ挙動)
    if (rel <= 3 && this.plate > 1) this._jumpToPlate(this.plate - 1);
    else if (rel <= 3) this._jumpToOpening();
    else this._jumpToPlate(this.plate);
  }
}

/* 実音源タイマーを生成。読込失敗時は合成音PlateTimerにフォールバック
   (合成音は段末で rowEnd を発火して待つ旧仕様のまま。パネル側が自動再開する。審判録音も無し) */
export async function createPlateTimer({ count, startDelay, interval, rowGap, randomMax, rowRandomMax, useVoices = true, onState, onBuzzer }) {
  try {
    // コンテキストの健全化(必要なら作り直し)は呼び出し側が primeAudioCtx() で
    // クリックの同期部分に済ませてある。ここでは今の世代用のバッファをデコードするだけ
    const buffer = await loadPlateClip();
    const voices = useVoices ? await loadRefVoices() : {};
    return { timer: new AudioPlateTimer({ buffer, count, startDelay, interval, rowGap, randomMax, rowRandomMax, voices, onState, onBuzzer }), mode: 'audio' };
  } catch (err) {
    console.warn('実音源の読込に失敗。合成音にフォールバックします:', err);
    return { timer: new PlateTimer({ count, interval: Math.max(3, interval || 7), onState }), mode: 'synth' };
  }
}
