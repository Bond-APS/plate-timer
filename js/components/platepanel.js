/* プレートタイマーパネル(タイマー画面で使用)。
   実音声タイマー(audiotimer)を使い、live=true ならマイクの発砲音検出で
   開始ブザー→発砲の反応時間を枚ごとに表示し、onResults(reactions[]) で呼び出し側へ渡す
   (呼び出し側=タイマー画面が結果入力に反応時間を付けて保存する)。
   段(5枚)の継ぎ目は自動で継続する(インターバル+段間追加秒)。
   音声・マイク・画面ロック周りの挙動は元アプリ(射撃ノート)から変えていない。
   追加したのは defaults(設定値の注入。設定UIは設定画面に移した)・onStart/onDone(画面側への通知)・
   onLiveChange(マイク計測ON/OFFの記憶)・panel.api(設定値の取得/変更とマイクON操作)のみ。 */
import { el, toast } from '../util.js';
import { createPlateTimer, getAudioCtx, hasAudioCtx, primeAudioCtx, checkAudioCtxAlive, loadPlateClip, loadRefVoices, setVoiceSet, REF_SLOTS } from './audiotimer.js';
import { LiveShotDetector } from './livedetect.js';

const CIRC = 477.5;
const KEEPALIVE_URL = new URL('../../audio/keepalive.mp4', import.meta.url).href; // 相対パス(サブパス配信対応)

/* 既定値。startDelay は審判の冒頭音声が読めなかったときだけ使う内部値(UIには出さない) */
export const PANEL_DEFAULTS = { voice: 'referee', interval: 12, rowGap: 14, random: true, randomMax: 2, rowRandomMax: 3, startDelay: 10 };
export const VOICE_LABELS = { referee: '審判音声', 'ai-male': 'AI音声(男性)', 'ai-female': 'AI音声(女性)' };

export function createPlateTimerPanel({ count = 15, live = false, wrapDetails = false, onResults = null, defaults = {}, onStart = null, onDone = null, onLiveChange = null }) {
  const panel = el(`<div class="timer-panel">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px">
      <button class="btn t-skipprev" disabled title="パートの頭へ / 前のパートへ" style="padding:8px 10px">|◀</button>
      <div class="timer-ring" style="margin:0">
        <svg viewBox="0 0 168 168" width="168" height="168">
          <circle class="tr-bg" cx="84" cy="84" r="76"/>
          <circle class="tr-fg" cx="84" cy="84" r="76" stroke-dasharray="${CIRC}" stroke-dashoffset="0"/>
        </svg>
        <div class="timer-center"><div class="tc-main">－</div><div class="tc-sub">待機中</div></div>
      </div>
      <button class="btn t-skipnext" disabled title="次のパートへ" style="padding:8px 10px">▶|</button>
    </div>
    <div class="small muted t-summary"></div>
    <div class="small muted t-mode"></div>
    <div class="small muted t-wakelock"></div>
    ${live ? `
    <div class="live-row">
      <label class="small"><input type="checkbox" class="t-live"> 🎙 反応時間を計測(マイク)</label>
      <span class="small muted t-live-note"></span>
    </div>
    <div class="reaction-chips"></div>
    <div class="small t-live-summary"></div>` : ''}
    <div class="timer-controls">
      <button class="btn primary t-start">開始</button>
      <button class="btn t-stop" disabled>停止</button>
    </div>
  </div>`);

  // タイマー設定は設定画面からのみ変える。パネルは値を持つだけ(開始時に読む)
  let cfg = { ...PANEL_DEFAULTS, ...defaults };
  const summaryEl = panel.querySelector('.t-summary');
  const renderSettingsSummary = () => {
    summaryEl.textContent = `次の的へ ${cfg.interval}秒 ・ 5枚ごと ${cfg.rowGap}秒` +
      `${cfg.random ? `(+最大${cfg.randomMax}/${cfg.rowRandomMax}秒ランダム)` : ''}` +
      ` ・ ${VOICE_LABELS[cfg.voice] || VOICE_LABELS.referee}`;
  };
  renderSettingsSummary();

  const fg = panel.querySelector('.tr-fg');
  const mainTxt = panel.querySelector('.tc-main');
  const subTxt = panel.querySelector('.tc-sub');
  const modeTxt = panel.querySelector('.t-mode');
  const startBtn = panel.querySelector('.t-start');
  const stopBtn = panel.querySelector('.t-stop');
  const prevBtn = panel.querySelector('.t-skipprev');
  const nextBtn = panel.querySelector('.t-skipnext');
  const setSkipEnabled = (on) => { prevBtn.disabled = !on; nextBtn.disabled = !on; };

  let timer = null;
  let mode = null;
  let detector = null;
  let lastPlate = 0;
  let curRowGap = 14;
  let autoResume = null; // 合成音フォールバック時の段自動再開タイマー
  let running = false;
  const results = new Map(); // plate -> {reaction, over} | null(未検出)

  /* iPhone対策: タイマー実行中だけ無音メディアをループ再生する。
     - <audio>(無音): ロック中もメディア再生が続き、オーディオセッションと
       事前予約済みWebAudioを生かし続ける
     - <video>(無音・インライン再生): 再生中は画面の自動ロックがかかりにくくなる
     加えてWake Lock APIが使える環境(HTTPS/localhost)では画面ロック自体を抑止する。
     再生開始は必ず開始ボタンのクリック処理の同期部分で行う(await後だとiOSが拒否することがある) */
  const keepalive = document.createElement('video');
  keepalive.src = KEEPALIVE_URL;
  keepalive.loop = true;
  keepalive.preload = 'auto';
  keepalive.setAttribute('playsinline', '');
  keepalive.style.cssText = 'position:absolute;width:2px;height:2px;opacity:0.01;pointer-events:none';
  panel.appendChild(keepalive);
  const keepaliveAudio = document.createElement('audio');
  keepaliveAudio.src = KEEPALIVE_URL; // 同じファイルの音声トラック(無音)を使う
  keepaliveAudio.loop = true;
  keepaliveAudio.preload = 'auto';
  panel.appendChild(keepaliveAudio);
  let wakeLock = null;
  const acquireWakeLock = async () => {
    try { wakeLock = await navigator.wakeLock?.request('screen') ?? null; } catch (e) { wakeLock = null; }
  };
  // Wake Lock APIはセキュアコンテキスト(https/localhost)でのみ使える。
  // httpのURLで開いているとiPhoneは時間で画面ロックするので、その旨を出しておく
  if (!navigator.wakeLock) {
    panel.querySelector('.t-wakelock').textContent = '画面ロック抑止は https のページで有効になります(今のURLでは自動ロックが働きます)';
  }
  const setAudioSession = (type) => {
    // iOS17+の正式API。'playback'(マイク使用中は'play-and-record')を宣言すると
    // サイレントスイッチONでもWebAudioが鳴る。無い環境ではキープアライブ動画が代替
    try { if (navigator.audioSession) navigator.audioSession.type = type; } catch (e) { /* 未対応は無視 */ }
  };
  // ロック中断のあとはmediaElementがエラー状態で残りplay()が通らないことがあるので、
  // 失敗したら load() でメディアを読み直してからもう一度再生する
  const playKeepalive = (media) => {
    media.play().catch(() => {
      try { media.load(); media.play().catch(() => {}); } catch (e) { /* 再生できなくてもタイマーは動く */ }
    });
  };
  const sessionStart = () => {
    running = true;
    setAudioSession(detector?.enabled ? 'play-and-record' : 'playback');
    playKeepalive(keepalive);
    playKeepalive(keepaliveAudio);
    acquireWakeLock();
  };
  const sessionEnd = () => {
    running = false;
    setAudioSession('auto');
    keepalive.pause();
    keepaliveAudio.pause();
    wakeLock?.release().catch(() => {});
    wakeLock = null;
  };
  const onVisible = () => {
    if (!panel.isConnected) { document.removeEventListener('visibilitychange', onVisible); return; }
    if (document.visibilityState !== 'visible') return;
    if (hasAudioCtx()) getAudioCtx().resume();
    if (running) {
      playKeepalive(keepalive);
      playKeepalive(keepaliveAudio);
      acquireWakeLock(); // ロック解除・タブ復帰でWake Lockは失効するため取り直す
    }
    // 画面ロックでオーディオセッションが切れると state は 'running' のままでも音が出なくなる。
    // 音声クロックが進むかを確かめ、止まっていれば作り直しの印が付く(次の「開始」で作り直す)
    checkAudioCtxAlive().then((alive) => {
      if (alive || !panel.isConnected || !running) return;
      timer?.stop();
      reset();
      subTxt.textContent = '中断しました';
      toast('画面ロックで音声が止まりました。「開始」で鳴り直します', 'warn');
    });
  };
  document.addEventListener('visibilitychange', onVisible);

  // 音源を先読み(開始ボタンの待ちも無くす)。正常時は何も表示しない
  loadPlateClip()
    .catch(() => { modeTxt.textContent = '⚠ 実音源を読み込めないため合成音モードになります'; });

  // 審判録音(冒頭/段の間/終了)を先読み。選んだ音声セットにファイルが無いスロットは審判音声に戻る(audiotimer側)
  setVoiceSet(cfg.voice);
  loadRefVoices().then((voices) => {
    if (!REF_SLOTS.some(({ slot }) => voices[slot])) modeTxt.textContent = '⚠ 審判音声ファイルが見つかりません(コールのみで進行します)';
  });

  const reset = () => {
    clearTimeout(autoResume);
    sessionEnd();
    startBtn.disabled = false; stopBtn.disabled = true;
    setSkipEnabled(false);
    mainTxt.textContent = '－'; subTxt.textContent = '待機中';
    fg.style.strokeDashoffset = 0;
    fg.classList.remove('interval', 'call');
  };

  /* 計測結果を枚順の配列(秒、未検出はnull)にして呼び出し側へ渡す。
     マイク計測中に「開始」で結果を空にしたときも空配列を渡す(前回の保存値を置き換える)。
     マイクを使わない回は何も渡さない(保存済みの値を消さない) */
  const emitResults = () => {
    if (!onResults) return;
    if (!detector?.enabled && !results.size) return;
    const arr = Array.from({ length: count }, (_, i) => {
      const r = results.get(i + 1);
      return r ? Math.round(r.reaction * 100) / 100 : null;
    });
    onResults(arr);
  };

  const renderChips = () => {
    emitResults();
    const box = panel.querySelector('.reaction-chips');
    if (!box) return;
    box.innerHTML = [...results.entries()].map(([plate, r]) => {
      if (r == null) return `<span class="reaction-chip miss" title="${plate}枚目: 検出なし">${plate}: −</span>`;
      const cls = r.over ? 'over' : 'ok';
      return `<span class="reaction-chip ${cls}" title="${plate}枚目">${plate}: ${r.reaction.toFixed(2)}s</span>`;
    }).join('');
  };

  const renderSummary = () => {
    const box = panel.querySelector('.t-live-summary');
    if (!box) return;
    const rs = [...results.values()].filter((r) => r != null).map((r) => r.reaction);
    if (!rs.length) { box.textContent = ''; return; }
    const avg = rs.reduce((a, b) => a + b, 0) / rs.length;
    const over = [...results.values()].filter((r) => r?.over).length;
    box.innerHTML = `平均 <b>${avg.toFixed(2)}s</b> ・ 最速 ${Math.min(...rs).toFixed(2)}s ・ 最遅 ${Math.max(...rs).toFixed(2)}s` +
      (over ? ` ・ <span class="accent">3秒超過 ${over}枚</span>` : '');
  };

  const finalizePlate = (plate) => {
    if (plate >= 1 && detector?.enabled && !results.has(plate)) {
      results.set(plate, null);
      renderChips();
    }
  };

  const onState = (s) => {
    if (s.phase === 'done') {
      finalizePlate(lastPlate);
      sessionEnd();
      mainTxt.textContent = '終了';
      subTxt.textContent = '';
      fg.style.strokeDashoffset = 0;
      fg.classList.remove('interval', 'call');
      startBtn.disabled = false; stopBtn.disabled = true;
      setSkipEnabled(false);
      renderSummary();
      onDone?.(); // 15枚終了 → 画面側が結果入力を出す
      return;
    }
    if (s.phase === 'interrupted') {
      // タイマー実行中に画面ロックで音声が切れた。作り直しは次の「開始」で行われる
      finalizePlate(lastPlate);
      reset();
      subTxt.textContent = '中断しました';
      toast('画面ロックで音声が止まりました。「開始」で鳴り直します', 'warn');
      return;
    }
    if (s.phase === 'rowEnd') {
      // 合成音フォールバック時のみ発火。段間追加秒の後、自動で次の段へ
      finalizePlate(lastPlate);
      mainTxt.textContent = '段間';
      subTxt.textContent = '次の段まで待機中';
      clearTimeout(autoResume);
      autoResume = setTimeout(() => { timer?.resumeRow?.(); }, curRowGap * 1000);
      return;
    }
    const frac = s.total ? Math.max(0, Math.min(1, s.remain / s.total)) : 0;
    fg.style.strokeDashoffset = (CIRC * (1 - frac)).toFixed(1);
    fg.classList.toggle('interval', s.phase === 'interval');
    fg.classList.toggle('call', s.phase === 'call');
    mainTxt.textContent = s.remain.toFixed(1);
    subTxt.textContent = s.phase === 'shoot' ? `${s.plate}/${count}枚目`
      : s.phase === 'call' ? `${s.plate}枚目 コール`
      : s.sub === 'begin' ? 'サイティング練習'
      : s.sub === 'first' ? `${s.plate}枚目へ`
      : s.sub === 'row' ? '次の段へ'
      : s.sub === 'end' ? '終了'
      : `${s.plate + 1}枚目へ`;
  };

  const onBuzzer = ({ plate, startTime, endTime }) => {
    finalizePlate(plate - 1);
    lastPlate = plate;
    detector?.setWindow({ plate, startTime, endTime });
  };

  startBtn.addEventListener('click', async () => {
    if (startBtn.disabled) return;
    startBtn.disabled = true;
    // クリックの同期中に呼ぶ(オーディオの解錠とメディア再生の許可はユーザー操作中しか下りない)。
    // 前回ロックで中断していた場合はここでAudioContextが作り直される
    primeAudioCtx();
    sessionStart();
    clearTimeout(autoResume);
    timer?.stop();
    results.clear();
    lastPlate = 0;
    renderChips();
    renderSummary();
    onStart?.(); // 画面側が前回の結果入力を畳む
    const startDelay = Math.max(0, Number(cfg.startDelay) || 0);
    const interval = Math.max(0, Number(cfg.interval) || 0);
    const rowGap = Math.max(0, Number(cfg.rowGap) || 0);
    const randomMax = cfg.random ? Math.min(10, Math.max(0, Number(cfg.randomMax) || 0)) : 0;
    const rowRandomMax = cfg.random ? Math.min(15, Math.max(0, Number(cfg.rowRandomMax) || 0)) : 0;
    const useVoices = true; // 審判音声は必ず使う
    setVoiceSet(cfg.voice);
    curRowGap = rowGap;
    ({ timer, mode } = await createPlateTimer({ count, startDelay, interval, rowGap, randomMax, rowRandomMax, useVoices, onState, onBuzzer }));
    if (mode === 'synth') {
      modeTxt.textContent = '⚠ 実音源を読み込めないため合成音モード(反応時間計測は不可)';
    }
    if (detector && detector.ctx !== getAudioCtx()) {
      // ロック中断からの復帰でAudioContextを作り直した場合、旧コンテキストのマイク計測は使えない
      detector.stop();
      detector = null;
      const check = panel.querySelector('.t-live');
      if (check) { check.checked = false; panel.querySelector('.t-live-note').textContent = ''; }
      toast('マイク計測を解除しました。必要なら再度ONにしてください', 'warn');
    }
    timer.start();
    stopBtn.disabled = false;
    setSkipEnabled(mode === 'audio'); // 合成音フォールバックはパート移動非対応
    const startedTimer = timer;
    checkAudioCtxAlive().then((alive) => {
      // 念のための最終確認。ここで止まっていたら次の「開始」で作り直される
      if (alive || timer !== startedTimer || !running) return;
      timer?.stop();
      reset();
      subTxt.textContent = 'もう一度「開始」を';
      toast('音声を初期化しました。もう一度「開始」を押してください', 'warn');
    });
  });
  stopBtn.addEventListener('click', () => { timer?.stop(); reset(); });
  prevBtn.addEventListener('click', () => timer?.skipPrev?.());
  nextBtn.addEventListener('click', () => timer?.skipNext?.());

  // ライブ計測(マイク)
  const liveCheck = panel.querySelector('.t-live');
  liveCheck?.addEventListener('change', async () => {
    const note = panel.querySelector('.t-live-note');
    if (liveCheck.checked) {
      try {
        detector = new LiveShotDetector({
          ctx: getAudioCtx(),
          onShot: ({ plate, reaction, over }) => { results.set(plate, { reaction, over }); renderChips(); },
        });
        const ok = await detector.enable();
        if (!ok) { detector = null; return; } // 許可プロンプト中にOFF/画面遷移された(マイクは解放済み)
        note.textContent = '計測中(ブザー後の発砲音を検出)';
        onLiveChange?.(true);
      } catch (err) {
        detector?.stop(); // 途中まで取得したマイクを確実に解放
        detector = null;
        liveCheck.checked = false;
        note.textContent = '';
        toast(`マイクを使用できません: ${err.message}`, 'warn');
        onLiveChange?.(false, err);
      }
    } else {
      detector?.stop();
      detector = null;
      note.textContent = '';
      onLiveChange?.(false);
    }
  });

  /* 画面側から使う小さなAPI。setLive はチェックボックスを入れて change を同期発火するだけなので、
     マイク取得は上の change ハンドラ(元アプリと同じ経路)で行われる。ボタンのクリック処理から
     同期的に呼べばユーザー操作中の扱いになり、許可プロンプトが出せる */
  panel.api = {
    getSettings: () => ({ voice: cfg.voice, interval: cfg.interval, rowGap: cfg.rowGap, random: cfg.random, randomMax: cfg.randomMax, rowRandomMax: cfg.rowRandomMax }),
    setSettings: (vals) => { cfg = { ...PANEL_DEFAULTS, ...cfg, ...vals }; setVoiceSet(cfg.voice); renderSettingsSummary(); },
    isLive: () => !!detector?.enabled,
    setLive: (on) => {
      if (!liveCheck || liveCheck.checked === !!on) return;
      liveCheck.checked = !!on;
      liveCheck.dispatchEvent(new Event('change'));
    },
    isRunning: () => running,
    getReactions: () => Array.from({ length: count }, (_, i) => {
      const r = results.get(i + 1);
      return r ? Math.round(r.reaction * 100) / 100 : null;
    }),
    stop: () => { timer?.stop(); reset(); },
    /* 終了後の表示(「終了」・反応時間チップ・平均など)を待機中に戻す。表示だけで、マイクや音声セッションには触れない。
       保存/破棄のあと次の練習を違和感なく始められるようにするためのもの。実行中は何もしない */
    clearResults: () => {
      if (running) return;
      results.clear();
      lastPlate = 0;
      renderChips();
      renderSummary();
      mainTxt.textContent = '－'; subTxt.textContent = '待機中';
    },
  };

  if (!wrapDetails) return panel;
  const wrap = el('<details style="margin-top:12px"><summary class="small muted" style="cursor:pointer">音声タイマーで練習する</summary></details>');
  wrap.appendChild(panel);
  return wrap;
}
