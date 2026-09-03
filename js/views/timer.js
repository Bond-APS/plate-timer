/* タイマー画面: マイク案内 → タイマーパネル(流用。設定値は設定画面から) → 15枚終了後の結果入力(3段×5枚グリッド+メモ) → 保存 */
import { el, esc, toast, dateStr, timeStr, isStandalone, isIOS } from '../util.js';
import { createPlateTimerPanel } from '../components/platepanel.js';
import { createPlateGrid } from '../components/plategrid.js';
import { loadSettings, saveSettings, addSet, newId } from '../store.js';
import { plateRhythm, hitCount } from '../logic/rhythm.js';

const EMPTY = () => new Array(15).fill('miss');

export function createTimerView({ onSaved = null } = {}) {
  const root = el(`<div>
    <div class="card notice v-https" hidden>
      <b>このアドレスではマイクと画面ロック抑止が使えません。</b>
      <div class="small mt8">https で始まるアドレスで開き直してください。音声タイマーだけならこのままでも動きます。</div>
    </div>
    <div class="card notice blue v-micguide" hidden></div>
    <div class="card v-panel"></div>
    <div class="card v-result" hidden>
      <h2>結果入力<span class="h2-side">当たった的をタップ</span></h2>
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
        const hint = isIOS() && isStandalone()
          ? 'ホーム画面から開いた状態でマイクが使えない場合は、Safariでこのアドレスを開いて試してください。'
          : 'iPhoneの「設定 > Safari > マイク」やブラウザのサイト設定でマイクが「拒否」になっていないか確認してください。';
        renderMicGuide(hint);
      }
    },
  });
  q('.v-panel').appendChild(panel);
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
         iPhoneは本体を撃つ場所の近く(1〜2m以内)に置き、スピーカーの音量を上げておくと安定します。</div>
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
  const grid = createPlateGrid({ plates, onChange: (next) => { plates = next; renderHits(); } });
  q('.v-grid').appendChild(grid.root);

  function renderHits() { q('.v-hits').textContent = String(hitCount(plates)); }
  function renderChips() {
    const box = q('.v-chips');
    const any = reactions.some((r) => r != null);
    box.innerHTML = any ? reactions.map((r, i) => r == null
      ? `<span class="reaction-chip miss" title="${i + 1}枚目: 検出なし">${i + 1}: −</span>`
      : `<span class="reaction-chip ${r > 3 ? 'over' : 'ok'}" title="${i + 1}枚目">${i + 1}: ${r.toFixed(2)}s</span>`).join('') : '';
    const rh = plateRhythm(reactions);
    q('.v-rhythm').textContent = rh
      ? `反応時間 平均 ${rh.avg.toFixed(2)}s ±${rh.sd.toFixed(2)}(${rh.n}枚計測${rh.over ? `・3秒超過 ${rh.over}枚` : ''})`
      : (any ? '' : 'マイク計測なし(反応時間は記録されません)');
  }
  function showResult() {
    plates = EMPTY();
    grid.setPlates(plates);
    q('.v-note').value = '';
    renderHits();
    renderChips();
    q('.v-result').hidden = false;
    q('.v-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function hideResult() { q('.v-result').hidden = true; }

  q('.v-discard').addEventListener('click', () => { hideResult(); });
  q('.v-save').addEventListener('click', () => {
    const now = new Date();
    const set = {
      id: newId(),
      date: dateStr(now),
      time: timeStr(now),
      plates: plates.slice(),
      reactions: reactions.slice(),
      settings: panel.api.getSettings(),
      note: q('.v-note').value.trim(),
    };
    if (!addSet(set)) { toast('保存できませんでした(端末の保存領域が使えません)', 'warn'); return; }
    hideResult();
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
