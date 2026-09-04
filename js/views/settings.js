/* 設定画面: 音量バランス・タイマーの既定値・データ(バックアップ/全削除)・使い方・このアプリについて */
import { el, toast, dateStr, shareOrDownload, isIOS, isStandalone } from '../util.js';
import { loadSettings, saveSettings, loadSets, clearAll, toBackupJson, importBackupJson, DEFAULT_SETTINGS } from '../store.js';
import { PANEL_DEFAULTS } from '../components/platepanel.js';
import { DEFAULT_GAINS } from '../components/audiotimer.js';

const REPO_URL = 'https://github.com/Bond-APS/plate-timer';

export function createSettingsView({ onGainsChange = null, onSettingsChange = null } = {}) {
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
        <li>マイク計測ONなら、ターゲットごとの反応時間が記録されます。緑=3秒以内、赤=3秒超過、「−」=検出できず。</li>
        <li>「|◀」「▶|」で前後のパートへ移動できます。</li>
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
      renderCount(); renderTimer(); renderGains();
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
    renderCount(); renderTimer(); renderGains();
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
    show() { renderGains(); renderTimer(); renderCount(); renderEnv(); },
  };
}
