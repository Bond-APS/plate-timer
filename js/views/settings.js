/* 設定画面: 音量バランス・タイマーの既定値・発砲音の感度調整(マイク)・データ(バックアップ/全削除)・使い方・このアプリについて */
import { el, toast, dateStr, shareOrDownload, isIOS, isStandalone } from '../util.js';
import { loadSettings, saveSettings, loadSets, clearAll, toBackupJson, importBackupJson, DEFAULT_SETTINGS, DEFAULT_MIC, MIC_DB_MIN, MIC_DB_MAX } from '../store.js';
import { PANEL_DEFAULTS } from '../components/platepanel.js';
import { DEFAULT_GAINS, getAudioCtx, primeAudioCtx } from '../components/audiotimer.js';
import { LiveShotDetector } from '../components/livedetect.js';

const REPO_URL = 'https://github.com/Bond-APS/plate-timer';

export function createSettingsView({ onGainsChange = null, onSettingsChange = null, isTimerRunning = () => false } = {}) {
  const root = el(`<div>
    <div class="card">
      <h2>音量バランス<span class="h2-side">次の「開始」から反映</span></h2>
      <label class="field"><span>コール音声(プレート・スタンバイ・レディー・ブザー)</span>
        <div class="range-row"><input type="range" min="0" max="150" step="5" class="s-clip"><output class="s-clip-out"></output></div></label>
      <label class="field"><span>審判音声(冒頭・段の間・終了)</span>
        <div class="range-row"><input type="range" min="0" max="150" step="5" class="s-voice"><output class="s-voice-out"></output></div></label>
      <div class="small muted">100% が元の録音バランス(コール音声は実測に合わせて内部で半分に下げてあります)。本体の音量は別途上げてください。</div>
      <div class="row mt8"><button class="btn sm s-gains-reset">既定に戻す</button></div>
    </div>

    <div class="card">
      <h2>タイマー設定</h2>
      <label class="field"><span>音声</span>
        <select class="s-voiceset">
          <option value="referee">審判音声(実録音)</option>
          <option value="ai-male">AI音声(男性)</option>
          <option value="ai-female">AI音声(女性)</option>
        </select></label>
      <div class="small muted s-voiceset-note" style="margin:-6px 0 12px"></div>
      <div class="field-inline" style="margin-bottom:10px"><span style="width:150px">次の的へのインターバル</span><input type="number" min="0" max="60" step="1" class="s-interval">秒</div>
      <div class="field-inline" style="margin-bottom:10px"><span style="width:150px">5枚ごとのインターバル</span><input type="number" min="0" max="120" step="1" class="s-rowgap">秒</div>
      <div class="field-inline" style="margin-bottom:10px"><label><input type="checkbox" class="s-random"> インターバルをランダムに延ばす(タイミングの先読み防止)</label></div>
      <div class="field-inline" style="margin-bottom:10px"><span style="width:150px">次の的へ +最大</span><input type="number" min="0" max="10" step="0.5" class="s-randmax">秒</div>
      <div class="field-inline"><span style="width:150px">5枚ごと +最大</span><input type="number" min="0" max="15" step="0.5" class="s-rowrand">秒</div>
      <div class="row mt12"><button class="btn sm s-timer-reset">既定に戻す</button></div>
    </div>

    <div class="card">
      <h2>発砲音の感度調整</h2>
      <div class="row">
        <button class="btn primary s-cal-start">調整を始める</button>
        <button class="btn s-cal-stop" hidden>調整を終了</button>
        <button class="btn sm s-cal-reset" hidden>最大をリセット</button>
        <span class="small muted s-cal-note"></span>
      </div>
      <div class="level-meter mt12">
        <div class="lm-track">
          <div class="lm-bar"><div class="lm-level"></div><div class="lm-peak" hidden></div></div>
          <div class="lm-thr"><div class="lm-thr-label s-thr-out"></div></div>
        </div>
        <div class="lm-scale"><span>−80</span><span>−60</span><span>−40</span><span>−20</span><span>0 dB</span></div>
        <div class="lm-read small"><span>今 <b class="s-lv-now">−</b></span><span>最大 <b class="s-lv-max">−</b></span><span class="lm-read-thr">しきい値 <b class="s-thr-val"></b></span></div>
      </div>
    </div>

    <div class="card">
      <h2>データ<span class="h2-side s-count"></span></h2>
      <div class="small muted">記録はこの端末(このブラウザ)の中だけに保存されます。サーバーには送られません。機種変更や、Safariの「Webサイトデータを削除」に備えて、ときどきバックアップを書き出してください。</div>
      <div class="row mt12">
        <button class="btn s-export">バックアップファイルを書き出し</button>
        <label class="btn">バックアップを読み込み<input type="file" accept="application/json,.json" class="s-import" hidden></label>
      </div>
      <div class="row mt12"><button class="btn danger s-clear">履歴と設定をすべて削除</button></div>
    </div>

    <div class="card howto">
      <h2>使い方</h2>
      <h3>準備</h3>
      <ol>
        <li>iPhoneは Safari の共有ボタン → 「ホーム画面に追加」を選ぶと、以後はアイコンから起動できます(オフラインでも動きます)。Androidは Chrome のメニュー(⋮) → 「ホーム画面に追加」または「アプリをインストール」。</li>
        <li>初回は「マイクを許可して計測する」を押して、マイクを許可してください。</li>
        <li>端末は撃つ場所の近く(1〜2m以内)に置き、音量を上げてください。サイレントスイッチがONでも鳴るよう作ってありますが、鳴らなければ音量ボタンを確認してください。</li>
      </ol>
      <h3>練習</h3>
      <ol>
        <li>「開始」を押す。審判音声のあと「プレート、スタンバイ、レディー」→ 開始ブザー → 3秒 → 終了ブザーが15枚ぶん自動で流れます。</li>
        <li>マイク計測ON(タイマー画面いちばん下の「練習の条件」)なら、タイマーの下の表に枚ごとの反応時間が出ます。赤=3秒超過、「−」=検出できず。</li>
        <li>「|◀」「▶|」で前後のパートへ移動できます。</li>
        <li>「一時停止」で音を止め、「再開」で<b>止めた場所から</b>続けられます(弾を詰め直すときなどに)。「停止」は最初からやり直しです。</li>
        <li>15枚終わると結果入力が出ます。当たった的をタップして「保存」を押してください。</li>
      </ol>
      <h3>知っておくこと</h3>
      <ul>
        <li>反応時間が <b>2.95〜3.30秒</b> の発砲は、終了ブザーの音と重なるため計測できません(「−」になります)。仕様上の制約です。</li>
        <li>タイマー中に画面がロックされて音が止まったときは「中断しました」と出ます。もう一度「開始」を押してください。</li>
        <li>ホーム画面から起動してマイクが使えないときは、ブラウザで同じアドレスを開いて試してください。</li>
        <li>LINEなどのアプリの中で開くとマイクは使えません。メニューから「Safariで開く」「Chromeで開く」を選んでください。</li>
        <li>Androidで「Permission denied」と出るときは、Chromeのアドレスバー左のアイコン → 権限 → マイクを許可。出ない場合は Androidの設定 → アプリ → Chrome → 権限 → マイク を許可してから再読み込み。</li>
        <li>反応時間は、実際に聞こえた開始ブザーを基準に自動で補正します。端末を離しすぎるとブザーを拾えず、補正が効かないことがあります。</li>
        <li>近くで他の人も撃っていて反応時間がおかしいときは、上の「発砲音の感度調整」で自分の発砲だけ拾うようにしきい値を決めてください。</li>
        <li>Bluetoothスピーカーの遅延は自動で補正しますが、有線または本体スピーカーのほうが正確です。</li>
      </ul>
    </div>

    <div class="card soft">
      <h2>このアプリについて</h2>
      <div class="small">
        APSカップ ハンドガン部門「プレート」(6m・3段×5枚・1枚3秒)の自宅練習用タイマーです。
        アカウント登録・サーバー通信・アクセス解析はありません。<br>
        コードは MIT ライセンス。音声ファイル(コール・審判音声)は本アプリでの利用に限ります。<br>
        <a href="${REPO_URL}" target="_blank" rel="noopener">${REPO_URL}</a>
        <div class="muted mt8 s-env"></div>
      </div>
    </div>
  </div>`);

  const q = (s) => root.querySelector(s);

  /* ---------- 音量 ---------- */
  function renderGains() {
    const g = loadSettings().gains;
    q('.s-clip').value = Math.round((g.clip / DEFAULT_GAINS.clip) * 100);
    q('.s-voice').value = Math.round((g.voice / DEFAULT_GAINS.voice) * 100);
    q('.s-clip-out').textContent = `${q('.s-clip').value}%`;
    q('.s-voice-out').textContent = `${q('.s-voice').value}%`;
  }
  const onGain = () => {
    q('.s-clip-out').textContent = `${q('.s-clip').value}%`;
    q('.s-voice-out').textContent = `${q('.s-voice').value}%`;
  };
  const commitGain = () => {
    saveSettings({ gains: { clip: (Number(q('.s-clip').value) / 100) * DEFAULT_GAINS.clip, voice: (Number(q('.s-voice').value) / 100) * DEFAULT_GAINS.voice } });
    onGainsChange?.();
  };
  q('.s-clip').addEventListener('input', onGain);
  q('.s-voice').addEventListener('input', onGain);
  q('.s-clip').addEventListener('change', commitGain);
  q('.s-voice').addEventListener('change', commitGain);
  q('.s-gains-reset').addEventListener('click', () => { saveSettings({ gains: { ...DEFAULT_GAINS } }); renderGains(); onGainsChange?.(); });

  /* ---------- 既定値 ---------- */
  function renderTimer() {
    const t = loadSettings().timer;
    q('.s-voiceset').value = t.voice || 'referee';
    q('.s-interval').value = t.interval;
    q('.s-rowgap').value = t.rowGap;
    q('.s-random').checked = !!t.random;
    q('.s-randmax').value = t.randomMax;
    q('.s-rowrand').value = t.rowRandomMax;
    q('.s-randmax').disabled = !t.random;
    q('.s-rowrand').disabled = !t.random;
    renderVoiceNote();
  }
  // 選んだ音声セットのファイルが揃っているかを表示(無いスロットは審判音声で補われる)
  async function renderVoiceNote() {
    const set = q('.s-voiceset').value;
    const note = q('.s-voiceset-note');
    if (set === 'referee') { note.textContent = '冒頭・段の間・終了の指示は審判の実録音です。'; return; }
    const slots = ['opening', 'break', 'finish'];
    const found = await Promise.all(slots.map(async (slot) => {
      try { return (await fetch(new URL(`../../audio/${set}/ref-${slot}.m4a`, import.meta.url).href, { method: 'HEAD' })).ok; } catch (e) { return false; }
    }));
    const n = found.filter(Boolean).length;
    note.textContent = n === 3 ? 'AI音声のファイルが揃っています。'
      : n === 0 ? 'AI音声のファイルがまだ入っていないため、当面は審判音声で再生されます。'
      : `AI音声は${n}/3ファイル。足りない部分は審判音声で補います。`;
  }
  const num = (sel, min, max, fb) => { const v = Number(q(sel).value); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fb; };
  const commitTimer = () => {
    saveSettings({ timer: {
      voice: q('.s-voiceset').value,
      interval: num('.s-interval', 0, 60, PANEL_DEFAULTS.interval),
      rowGap: num('.s-rowgap', 0, 120, PANEL_DEFAULTS.rowGap),
      random: q('.s-random').checked,
      randomMax: num('.s-randmax', 0, 10, PANEL_DEFAULTS.randomMax),
      rowRandomMax: num('.s-rowrand', 0, 15, PANEL_DEFAULTS.rowRandomMax),
    } });
    renderTimer();
    onSettingsChange?.();
  };
  ['.s-voiceset', '.s-interval', '.s-rowgap', '.s-random', '.s-randmax', '.s-rowrand'].forEach((s) => q(s).addEventListener('change', commitTimer));
  q('.s-timer-reset').addEventListener('click', () => { saveSettings({ timer: { ...PANEL_DEFAULTS } }); renderTimer(); onSettingsChange?.(); });

  /* ---------- 発砲音の感度調整 ----------
     マイクを開いて worklet のレベル通知(約80msごとの最大dB)を横棒(今の音量)と最大値の目印に出す。
     しきい値はスライダーで決める(常に有効。既定 DEFAULT_MIC.minDb)。判定の式は livedetect.js の loudEnough と同じ(db >= minDb)。
     タイマーのマイク計測とは別のマイク取得なので、実行中は使えないようにする */
  const pct = (db) => Math.max(0, Math.min(100, ((db - MIC_DB_MIN) / (MIC_DB_MAX - MIC_DB_MIN)) * 100));
  const fmtDb = (db) => (Number.isFinite(db) ? `${Math.round(Math.max(MIC_DB_MIN, db))} dB` : '−');
  let cal = null;       // 調整中: { detector }
  let calMax = null;    // 調整開始(または最大リセット)からの最大dB
  let thr = DEFAULT_MIC.minDb; // 表示中のしきい値(ドラッグ中は未保存の値)
  const paintThr = (minDb) => {
    thr = minDb;
    q('.s-thr-out').textContent = `${minDb} dB`;
    q('.s-thr-val').textContent = `${minDb} dB`;
    q('.lm-thr').style.left = `${pct(minDb)}%`;
  };
  function renderMic() { paintThr(loadSettings().mic.minDb); }
  const commitMic = (minDb) => { saveSettings({ mic: { minDb } }); paintThr(loadSettings().mic.minDb); onSettingsChange?.(); };
  /* しきい値の赤い線はバーの上で直接ドラッグして決める(触れた位置へ移動し、指を離したときに保存)。
     バーのどこを触っても効くので、線そのものを狙わなくてよい */
  const track = q('.lm-track');
  let dragging = false;
  const thrFromPointer = (e) => {
    const r = q('.lm-bar').getBoundingClientRect();
    const f = r.width > 0 ? (e.clientX - r.left) / r.width : 0;
    return Math.round(MIC_DB_MIN + Math.max(0, Math.min(1, f)) * (MIC_DB_MAX - MIC_DB_MIN));
  };
  track.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    dragging = true;
    try { track.setPointerCapture(e.pointerId); } catch (err) { /* 未対応でも move/up はバー内なら届く */ }
    paintThr(thrFromPointer(e));
    e.preventDefault();
  });
  track.addEventListener('pointermove', (e) => { if (dragging) paintThr(thrFromPointer(e)); });
  const endDrag = () => { if (!dragging) return; dragging = false; commitMic(thr); };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  const renderLevel = (now) => {
    q('.lm-level').style.width = now == null ? '0%' : `${pct(now)}%`;
    q('.s-lv-now').textContent = fmtDb(now);
    q('.s-lv-max').textContent = fmtDb(calMax);
    const peak = q('.lm-peak');
    peak.hidden = calMax == null;
    if (calMax != null) peak.style.left = `${pct(calMax)}%`;
  };
  const onCalEvent = (d) => {
    if (!cal || d.type !== 'level') return;
    if (calMax == null || d.db > calMax) calMax = d.db;
    renderLevel(d.db);
  };
  const setCalUI = (on) => {
    q('.s-cal-start').hidden = on;
    q('.s-cal-start').disabled = false;
    q('.s-cal-stop').hidden = !on;
    q('.s-cal-reset').hidden = !on;
    root.querySelector('.level-meter').classList.toggle('live', on);
    if (!on) renderLevel(null);
  };
  q('.s-cal-start').addEventListener('click', async () => {
    if (cal || q('.s-cal-start').disabled) return;
    if (isTimerRunning()) { toast('タイマー実行中は調整できません。停止してから行ってください', 'warn'); return; }
    const note = q('.s-cal-note');
    primeAudioCtx(); // クリックの同期中に(中断していた AudioContext があれば作り直す)
    const detector = new LiveShotDetector({ ctx: getAudioCtx(), onShot: null, onEvent: onCalEvent });
    cal = { detector };
    q('.s-cal-start').disabled = true;
    note.textContent = 'マイクを準備中…';
    try {
      const ok = await detector.enable();
      if (cal?.detector !== detector) { detector.stop(); return; } // 待っている間に画面を離れた
      if (!ok) { cal = null; setCalUI(false); note.textContent = ''; return; }
      detector.setMeter(true);
      calMax = null;
      setCalUI(true);
      note.textContent = '聞き取り中。撃ってみてください';
    } catch (err) {
      detector.stop();
      if (cal?.detector === detector) cal = null;
      setCalUI(false);
      note.textContent = '';
      toast(`マイクを使用できません: ${err.message}`, 'warn');
    }
  });
  function stopCal() {
    if (!cal) return;
    cal.detector.stop();
    cal = null;
    setCalUI(false);
    q('.s-cal-note').textContent = '';
  }
  q('.s-cal-stop').addEventListener('click', stopCal);
  q('.s-cal-reset').addEventListener('click', () => { calMax = null; renderLevel(null); });

  /* ---------- データ ---------- */
  function renderCount() {
    const n = loadSets().length;
    q('.s-count').textContent = `${n}セット`;
  }
  q('.s-export').addEventListener('click', async () => {
    const file = new File([toBackupJson()], `aps-plate-backup-${dateStr()}.json`, { type: 'application/json' });
    const how = await shareOrDownload(file, 'APSプレートタイマー バックアップ');
    if (how === 'download') toast('バックアップをダウンロードしました');
  });
  q('.s-import').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const added = importBackupJson(await f.text());
      renderCount(); renderTimer(); renderGains(); renderMic();
      onGainsChange?.(); onSettingsChange?.();
      toast(added ? `${added}セットを読み込みました` : '新しいセットはありませんでした(重複は除外)');
    } catch (err) {
      toast(`読み込めません: ${err.message}`, 'warn');
    }
  });
  q('.s-clear').addEventListener('click', () => {
    const n = loadSets().length;
    if (!confirm(`履歴${n}セットと設定をすべて削除します。元に戻せません。よろしいですか?`)) return;
    if (n > 0 && !confirm('本当に削除しますか?(バックアップを書き出していない場合は先に書き出してください)')) return;
    clearAll();
    renderCount(); renderTimer(); renderGains(); renderMic();
    onGainsChange?.(); onSettingsChange?.();
    toast('すべて削除しました');
  });

  function renderEnv() {
    const parts = [];
    parts.push(window.isSecureContext ? 'https: OK' : 'https: NG(マイク・画面ロック抑止は使えません)');
    parts.push(`起動: ${isStandalone() ? 'ホーム画面' : 'ブラウザ'}`);
    parts.push(`マイク: ${navigator.mediaDevices?.getUserMedia ? '対応' : '非対応'}`);
    parts.push(`Wake Lock: ${navigator.wakeLock ? '対応' : '非対応'}`);
    parts.push(`AudioSession: ${navigator.audioSession ? '対応' : '非対応'}`);
    if (isIOS()) parts.push('iOS');
    q('.s-env').textContent = parts.join(' ・ ');
  }

  void DEFAULT_SETTINGS;
  return {
    root,
    show() { renderGains(); renderTimer(); renderMic(); renderCount(); renderEnv(); },
    hide() { stopCal(); }, // 画面を離れたらマイクを解放する
  };
}
