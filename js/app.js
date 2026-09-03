/* APSプレートタイマー — 入口。ハッシュルーター(#/timer, #/history, #/history/:id, #/settings)。
   3つの画面は最初に1回だけ組み立て、切替は hidden の付け外しだけで行う
   (タイマー画面を外すとタイマーが止まるため、履歴を見ている間も鳴り続けられるようにする)。 */
import { toast } from './util.js';
import { loadSettings } from './store.js';
import { setGains } from './components/audiotimer.js';
import { createTimerView } from './views/timer.js';
import { createHistoryView } from './views/history.js';
import { createSettingsView } from './views/settings.js';

export const APP_VERSION = '1.0.0';

const views = {};
const roots = {
  timer: document.getElementById('view-timer'),
  history: document.getElementById('view-history'),
  settings: document.getElementById('view-settings'),
};

function applyGains() { setGains(loadSettings().gains); }
applyGains();

views.timer = createTimerView({ onSaved: (id) => { location.hash = `#/history/${id}`; } });
views.history = createHistoryView();
views.settings = createSettingsView({ onGainsChange: applyGains, onSettingsChange: () => views.timer.refreshDefaults?.() });
roots.timer.appendChild(views.timer.root);
roots.history.appendChild(views.history.root);
roots.settings.appendChild(views.settings.root);

function route() {
  const hash = location.hash || '#/timer';
  const m = /^#\/(timer|history|settings)(?:\/([^/]+))?/.exec(hash);
  const name = m ? m[1] : 'timer';
  const arg = m ? m[2] : null;
  for (const [k, root] of Object.entries(roots)) root.hidden = k !== name;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === name));
  views[name].show?.(arg);
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
route();

/* PWA: Service Worker 登録(https/localhost のみ)。更新があればトーストで知らせる(自動再読み込みはしない: タイマー中断を避ける) */
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) {
          toast('新しいバージョンがあります。次回起動時に更新されます', 'ok', 4000);
        }
      });
    });
  }).catch(() => { /* 登録できなくても通常のWebページとして動く */ });
}

document.getElementById('h-sub').textContent = `v${APP_VERSION}`;
