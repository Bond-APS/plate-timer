/* タイマー画面: マイク案内 → タイマーパネル(流用。設定値は設定画面から) → 15枚終了後の結果入力(3段×5枚グリッド+メモ) → 保存 */
import { el, esc, toast, dateStr, timeStr, isStandalone, isIOS, isAndroid, inAppBrowserName } from '../util.js';
import { createPlateTimerPanel } from '../components/platepanel.js';
import { createPlateGrid } from '../components/plategrid.js';
import { loadSettings, saveSettings, addSet, newId } from '../store.js';
import { plateRhythm, hitCount, plateShots, MIN_REACTION } from '../logic/rhythm.js';

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
      <div class="reaction-chips v-chips"></div>
      <div class="small muted v-rhythm" style="text-align:center"></div>
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
    onDirectionChange: (dir) => { direction = dir; settings = saveSettings({ direction: dir }); renderChips(); },
  });
  q('.v-grid').appendChild(grid.root); // 説明文(hint)はグリッド部品が的の列と同じ幅で描く

  function renderHits() { q('.v-hits').textContent = String(hitCount(plates)); }
  /* 撃順チップ: 射撃方向に従って撃順→的位置を解き、○(ヒット)/✕(ミス)を反応時間に重ねて出す */
  function renderChips() {
    const box = q('.v-chips');
    const any = reactions.some((r) => r != null);
    const shots = plateShots({ plates, reactions, direction });
    box.innerHTML = any ? shots.map((sh) => {
      const res = `<span class="rc-res">${sh.hit ? '○' : '✕'}</span>`;
      const cls = sh.hit ? 'res-hit' : 'res-miss';
      if (sh.suspect) return `<span class="reaction-chip miss ${cls}" title="${sh.order}枚目: ${MIN_REACTION}秒未満はブザーの誤検出として集計から外します">${res}${sh.order}: 誤検出</span>`;
      if (sh.reaction == null) return `<span class="reaction-chip miss ${cls}" title="${sh.order}枚目: 検出なし">${res}${sh.order}: −</span>`;
      return `<span class="reaction-chip ${sh.reaction > 3 ? 'over' : 'ok'} ${cls}" title="${sh.order}枚目">${res}${sh.order}: ${sh.reaction.toFixed(2)}s</span>`;
    }).join('') : '';
    const rh = plateRhythm(reactions);
    const mean = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : null);
    const hitR = shots.filter((sh) => sh.hit && sh.reaction != null).map((sh) => sh.reaction);
    const missR = shots.filter((sh) => !sh.hit && sh.reaction != null).map((sh) => sh.reaction);
    const cmp = hitR.length && missR.length ? ` ・ ヒット時 ${mean(hitR)}s / ミス時 ${mean(missR)}s` : '';
    q('.v-rhythm').textContent = rh
      ? `反応時間 平均 ${rh.avg.toFixed(2)}s ±${rh.sd.toFixed(2)}(${rh.n}枚計測${rh.over ? `・3秒超過 ${rh.over}枚` : ''}${cmp})`
      : (any ? '' : 'マイク計測なし(反応時間は記録されません)');
  }
  function showResult() {
    plates = EMPTY();
    grid.setPlates(plates);
    grid.setDirection(direction);
    q('.v-note').value = '';
    renderHits();
    renderChips();
    q('.v-result').hidden = false;
    q('.v-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hideResult() { q('.v-result').hidden = true; }
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
    /* 設定画面で既定値を変えたとき、タイマーが動いていなければ入力欄へ反映 */
    refreshDefaults() {
      settings = loadSettings();
      if (!panel.api.isRunning()) panel.api.setSettings(settings.timer);
    },
  };
}
