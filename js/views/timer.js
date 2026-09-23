/* タイマー画面: マイク案内 → タイマー(リングと操作ボタンだけ) → 反応時間の表 → 15枚終了後の結果入力(3段×5枚グリッド+反応時間の表+メモ) → 保存
   → 練習の条件(設定値の要約・マイク計測スイッチ。いちばん下) */
import { el, esc, toast, dateStr, timeStr, isStandalone, isIOS, isAndroid, inAppBrowserName } from '../util.js';
import { createPlateTimerPanel } from '../components/platepanel.js';
import { createPlateGrid } from '../components/plategrid.js';
import { loadSettings, saveSettings, addSet, newId, micThreshold } from '../store.js';
import { plateRhythm, hitCount, plateShots } from '../logic/rhythm.js';
import { reactionCell, reactionTableHtml, reactionSummaryHtml } from '../components/reactiontable.js';

const EMPTY = () => new Array(15).fill('miss');

export function createTimerView({ onSaved = null } = {}) {
  const root = el(`<div>
    <div class="card notice v-https" hidden>
      <b>このアドレスではマイクと画面ロック抑止が使えません。</b>
      <div class="small mt8">https で始まるアドレスで開き直してください。音声タイマーだけならこのままでも動きます。</div>
    </div>
    <div class="card notice v-inapp" hidden></div>
    <div class="card notice blue v-micguide" hidden></div>
    <div class="card v-panel"></div>
    <div class="card v-result" hidden>
      <h2>結果入力</h2>
      <div class="result-head"><span class="big v-hits">0</span><span class="of">/ 15 枚</span></div>
      <div class="v-grid"></div>
      <div class="v-react" hidden>
        <h3 class="sub-h">反応時間<span class="sub-h-side">○ ヒット ✕ ミス</span></h3>
        <div class="rt-wrap v-chips"></div>
        <div class="v-rhythm"></div>
      </div>
      <div class="small muted v-nomic" hidden>マイク計測なし(反応時間は記録されません)</div>
      <label class="field mt12"><span>メモ(任意)</span><input type="text" class="v-note" placeholder="例: 銃を替えた、上段が遅い" maxlength="200"></label>
      <div class="result-actions">
        <button class="btn ghost v-discard">破棄</button>
        <button class="btn primary v-save">保存</button>
      </div>
    </div>
  </div>`);

  const q = (s) => root.querySelector(s);
  let settings = loadSettings();
  let plates = EMPTY();
  let reactions = new Array(15).fill(null);
  let direction = settings.direction === 'rtl' ? 'rtl' : 'ltr'; // 射撃方向指定(前回の選択を初期値に)

  /* ---------- タイマーパネル(流用コンポーネント) ---------- */
  const panel = createPlateTimerPanel({
    count: 15,
    live: true,
    defaults: settings.timer,
    micThreshold: micThreshold(settings),
    direction,
    // 開始前に選んだ射撃方向を記憶し、結果入力の方向にも合わせる
    onDirectionChange: (dir) => { direction = dir; settings = saveSettings({ direction: dir }); grid.setDirection(dir); renderChips(); },
    onStart: () => { hideResult(); },
    onDone: () => { reactions = panel.api.getReactions(); showResult(); },
    onLiveChange: (on, err) => {
      settings = saveSettings({ live: on, micGuideSeen: true });
      if (on) { q('.v-micguide').hidden = true; return; }
      if (err) {
        // 失敗の理由をパネルがトーストで出す。ホーム画面起動で失敗した場合はSafariで開く案内を残す
        renderMicGuide(micHint());
      }
    },
  });
  q('.v-panel').appendChild(panel);
  // 反応時間の表はタイマーのすぐ下、練習の条件は画面のいちばん下に置く
  root.insertBefore(panel.parts.reactions, q('.v-result'));
  root.appendChild(panel.parts.info);
  /* マイク許可に失敗したときの、端末ごとの確認先 */
  function micHint() {
    const app = inAppBrowserName();
    if (app) return `${app}の中のブラウザではマイクを使えません。画面のメニューから「${isIOS() ? 'Safari' : 'Chrome'}で開く」を選んで開き直してください。`;
    if (isIOS()) {
      return isStandalone()
        ? 'ホーム画面から開いた状態でマイクが使えない場合は、Safariでこのアドレスを開いて試してください。'
        : 'iPhoneの「設定 > Safari > マイク」が「拒否」になっていないか確認してください。';
    }
    if (isAndroid()) {
      return 'Chromeのアドレスバー左のアイコン(サイト情報) → 「権限」 → マイクを「許可」にしてください。' +
        'それでも出ない場合は Androidの「設定 > アプリ > Chrome > 権限 > マイク」を「許可」にしてから、ページを再読み込みしてください。';
    }
    return 'ブラウザのサイト設定でマイクが「拒否」になっていないか確認してください。';
  }

  /* LINE等のアプリ内ブラウザで開いている場合はマイクが使えないので、最初から案内する */
  {
    const app = inAppBrowserName();
    if (app) {
      const box = q('.v-inapp');
      box.innerHTML = `<b>${esc(app)}の中のブラウザで開いています</b>
        <div class="small mt8">この状態ではマイク計測が使えず、ホーム画面にも追加できません。
        画面のメニュー(右上または右下の「…」)から「${isIOS() ? 'Safari' : 'Chrome'}で開く」を選ぶか、アドレスをコピーして${isIOS() ? 'Safari' : 'Chrome'}に貼り付けて開いてください。</div>`;
      box.hidden = false;
    }
  }

  /* ---------- マイク案内(初回) ---------- */
  function renderMicGuide(extra = '') {
    const box = q('.v-micguide');
    if (!window.isSecureContext) { box.hidden = true; return; }
    if (panel.api.isLive()) { box.hidden = true; return; }
    const again = settings.live; // 前回ON
    box.innerHTML = again
      ? `<div class="row between">
           <div><b>🎙 反応時間の計測</b><div class="small muted">前回はマイク計測ONでした。開始前にもう一度ONにしてください。</div></div>
           <button class="btn primary v-micon">マイクをONにする</button>
         </div>${extra ? `<div class="small mt8">${esc(extra)}</div>` : ''}`
      : `<b>🎙 反応時間を計測するには、マイクの許可が必要です</b>
         <div class="small mt8">開始ブザーから発砲までの秒数を、発砲音で自動計測します。音は端末の外に送られません。
         端末は撃つ場所の近く(1〜2m以内)に置き、スピーカーの音量を上げておくと安定します。</div>
         ${extra ? `<div class="small mt8">${esc(extra)}</div>` : ''}
         <div class="row mt12">
           <button class="btn primary v-micon">マイクを許可して計測する</button>
           <button class="btn ghost v-micskip">今回は使わない</button>
         </div>`;
    box.hidden = false;
    // クリック処理の中で同期的に setLive(true) → change イベント → getUserMedia(ユーザー操作中の扱いになる)
    box.querySelector('.v-micon')?.addEventListener('click', () => panel.api.setLive(true));
    box.querySelector('.v-micskip')?.addEventListener('click', () => {
      settings = saveSettings({ micGuideSeen: true });
      box.hidden = true;
    });
  }
  if (!window.isSecureContext) q('.v-https').hidden = false;
  if (!settings.micGuideSeen || settings.live) renderMicGuide();

  /* ---------- 結果入力 ---------- */
  const grid = createPlateGrid({
    plates, direction,
    hint: '射撃方向を選択してください<br>ヒットした的をタップしてください',
    onChange: (next) => { plates = next; renderHits(); renderChips(); },
    onDirectionChange: (dir) => { direction = dir; settings = saveSettings({ direction: dir }); panel.api.setDirection(dir); renderChips(); },
  });
  q('.v-grid').appendChild(grid.root); // 説明文(hint)はグリッド部品が的の列と同じ幅で描く

  function renderHits() { q('.v-hits').textContent = String(hitCount(plates)); }
  /* 反応時間の表(撃順)に、射撃方向から解いたヒット/ミスを重ねる */
  function renderChips() {
    const any = reactions.some((r) => r != null);
    q('.v-react').hidden = !any;
    q('.v-nomic').hidden = any;
    if (!any) return;
    const shots = plateShots({ plates, reactions, direction });
    const cells = shots.map((sh) => ({ ...reactionCell(reactions[sh.order - 1]), mark: sh.hit ? 'hit' : 'miss' }));
    q('.v-chips').innerHTML = reactionTableHtml(cells, { direction, caption: '的ごとの反応時間とヒット/ミス' });
    const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
    const hitR = shots.filter((sh) => sh.hit && sh.reaction != null).map((sh) => sh.reaction);
    const missR = shots.filter((sh) => !sh.hit && sh.reaction != null).map((sh) => sh.reaction);
    const rh = plateRhythm(reactions);
    // 句の途中で折り返さないよう、まとまりごとに nowrap の span にする
    const note = [rh ? `ばらつき ±${rh.sd.toFixed(2)}s(${rh.n}枚計測)` : '', hitR.length && missR.length ? `ヒット時 ${mean(hitR)}s / ミス時 ${mean(missR)}s` : '']
      .filter(Boolean).map((t) => `<span class="nw">${t}</span>`).join('<span class="sep"> ・ </span>');
    q('.v-rhythm').innerHTML = reactionSummaryHtml(rh, note);
  }
  function showResult() {
    plates = EMPTY();
    grid.setPlates(plates);
    grid.setDirection(direction);
    q('.v-note').value = '';
    renderHits();
    renderChips();
    q('.v-result').hidden = false;
    panel.api.setReactionsHidden(true); // 結果入力の表(ヒット/ミス付き)と重複させない
    q('.v-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hideResult() { q('.v-result').hidden = true; panel.api.setReactionsHidden(false); }
  /* 保存・破棄で結果を片付けたら、パネルの前回表示も待機中に戻す(タイマーに戻ったとき前回の結果が残らないように) */
  function closeResult() {
    hideResult();
    reactions = new Array(15).fill(null);
    panel.api.clearResults();
  }

  q('.v-discard').addEventListener('click', () => { closeResult(); });
  q('.v-save').addEventListener('click', () => {
    const now = new Date();
    const set = {
      id: newId(),
      date: dateStr(now),
      time: timeStr(now),
      plates: plates.slice(),
      reactions: reactions.slice(),
      direction,
      settings: panel.api.getSettings(),
      note: q('.v-note').value.trim(),
    };
    if (!addSet(set)) { toast('保存できませんでした(端末の保存領域が使えません)', 'warn'); return; }
    closeResult();
    toast(`保存しました: ${hitCount(set.plates)}/15枚`);
    onSaved?.(set.id);
  });

  return {
    root,
    show() { settings = loadSettings(); },
    /* 設定画面で既定値を変えたとき、タイマーが動いていなければ入力欄へ反映。発砲音の感度は実行中でも即反映 */
    refreshDefaults() {
      settings = loadSettings();
      if (!panel.api.isRunning()) panel.api.setSettings(settings.timer);
      panel.api.setMicThreshold(micThreshold(settings));
    },
    /* タイマー実行中か(設定画面の感度調整は実行中は使えない) */
    isRunning() { return panel.api.isRunning(); },
  };
}
