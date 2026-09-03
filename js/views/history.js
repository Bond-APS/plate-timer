/* 履歴画面: セット一覧・グラフ2つ・セット詳細・CSV書き出し */
import { el, esc, shortDate, longDate, toast, dateStr, shareOrDownload } from '../util.js';
import { loadSets, deleteSet, updateSet, toCsv } from '../store.js';
import { plateRhythm, rhythmLabel, hitCount, perPlateAverage, setSeries } from '../logic/rhythm.js';
import { rhythmTrendSvg, perPlateSvg } from '../components/charts.js';
import { createPlateGrid } from '../components/plategrid.js';
import { VOICE_LABELS } from '../components/platepanel.js';

const TREND_LIMIT = 20;

export function createHistoryView() {
  const root = el('<div></div>');

  function renderList() {
    const sets = loadSets();
    if (!sets.length) {
      root.innerHTML = `<div class="card"><div class="empty">まだ記録がありません。<br>タイマーで15枚撃って「保存」すると、ここに並びます。</div></div>`;
      return;
    }
    const recent = sets.slice(0, TREND_LIMIT);
    const series = setSeries(recent, TREND_LIMIT);
    const measured = recent.filter((s) => plateRhythm(s.reactions));
    const allR = recent.flatMap((s) => s.reactions).filter((r) => typeof r === 'number');
    const overall = plateRhythm(allR);
    const avgHits = recent.reduce((a, s) => a + hitCount(s.plates), 0) / recent.length;
    const trend = rhythmTrendSvg(series);
    const perPlate = perPlateSvg(perPlateAverage(measured));

    root.innerHTML = `
      <div class="card">
        <h2>直近${recent.length}セット<span class="h2-side">全${sets.length}セット</span></h2>
        <div class="stat-row">
          <div class="stat"><div class="stat-v">${avgHits.toFixed(1)}</div><div class="stat-l">平均ヒット/15</div></div>
          <div class="stat"><div class="stat-v">${overall ? overall.avg.toFixed(2) + 's' : '−'}</div><div class="stat-l">平均反応</div></div>
          <div class="stat"><div class="stat-v">${overall ? '±' + overall.sd.toFixed(2) : '−'}</div><div class="stat-l">ばらつき</div></div>
          <div class="stat"><div class="stat-v ${overall?.over ? 'accent' : ''}">${overall ? overall.over : '−'}</div><div class="stat-l">3秒超過(枚)</div></div>
        </div>
      </div>
      ${trend ? `<div class="card"><h2>セット別の反応時間<span class="h2-side">平均±ばらつき・赤線=3.0秒</span></h2>${trend}
        <div class="chart-legend">帯は平均±標準偏差。点が赤いセットは平均が3秒を超えています。</div></div>` : ''}
      ${perPlate ? `<div class="card"><h2>枚別の平均反応時間<span class="h2-side">1〜15枚目・直近${measured.length}セット</span></h2>${perPlate}
        <div class="chart-legend">何枚目で遅れるかの目安。段の継ぎ目(5・10枚目)は点線で区切っています。</div></div>` : ''}
      <div class="card">
        <h2>セット一覧<span class="h2-side"><button class="btn sm h-csv">CSV書き出し</button></span></h2>
        <div class="set-list">${sets.map(itemHtml).join('')}</div>
      </div>`;
    root.querySelector('.h-csv').addEventListener('click', exportCsv);
  }

  function itemHtml(s) {
    const r = plateRhythm(s.reactions);
    return `<a class="set-item" href="#/history/${esc(s.id)}">
      <div><div class="si-date">${esc(shortDate(s.date))}</div><div class="si-time">${esc(s.time)}</div></div>
      <div>
        <div class="si-hits">${hitCount(s.plates)}<small> /15</small></div>
        <div class="si-rhythm">${r ? `${esc(rhythmLabel(r))}${r.over ? ` <span class="si-over">超過${r.over}</span>` : ''}` : '反応時間なし'}${s.note ? ` ・ ${esc(s.note)}` : ''}</div>
      </div>
      <div class="si-chev">›</div>
    </a>`;
  }

  function renderDetail(id) {
    const s = loadSets().find((x) => x.id === id);
    if (!s) { location.hash = '#/history'; return; }
    const r = plateRhythm(s.reactions);
    const st = s.settings || {};
    root.innerHTML = `
      <div class="row between mt8" style="margin-bottom:8px">
        <a href="#/history" class="btn sm ghost">‹ 一覧へ</a>
        <button class="btn sm danger h-del">削除</button>
      </div>
      <div class="card">
        <h2>${esc(longDate(s.date))} ${esc(s.time)}</h2>
        <div class="result-head"><span class="big">${hitCount(s.plates)}</span><span class="of">/ 15 枚</span></div>
        <div class="h-grid"></div>
        ${r ? `<div class="stat-row mt12">
          <div class="stat"><div class="stat-v">${r.avg.toFixed(2)}s</div><div class="stat-l">平均反応</div></div>
          <div class="stat"><div class="stat-v">±${r.sd.toFixed(2)}</div><div class="stat-l">ばらつき</div></div>
          <div class="stat"><div class="stat-v">${r.min.toFixed(2)}</div><div class="stat-l">最速</div></div>
          <div class="stat"><div class="stat-v ${r.over ? 'accent' : ''}">${r.over}</div><div class="stat-l">3秒超過(枚)</div></div>
        </div>` : '<div class="small muted mt12" style="text-align:center">反応時間の計測なし</div>'}
        <div class="reaction-chips">${s.reactions.some((v) => v != null) ? s.reactions.map((v, i) => v == null
          ? `<span class="reaction-chip miss">${i + 1}: −</span>`
          : `<span class="reaction-chip ${v > 3 ? 'over' : 'ok'}">${i + 1}: ${v.toFixed(2)}s</span>`).join('') : ''}</div>
        <div class="small muted mt8" style="text-align:center">枚の番号は 下段→中段→上段、各段は左→右</div>
      </div>
      <div class="card">
        <h2>メモ<span class="h2-side"><button class="btn sm h-editnote">編集</button></span></h2>
        <div class="detail-note h-note">${s.note ? esc(s.note) : '<span class="muted">(なし)</span>'}</div>
      </div>
      <div class="card soft">
        <h2>このセットの設定</h2>
        <dl class="kv">
          <dt>音声</dt><dd>${VOICE_LABELS[st.voice] || (st.useVoices === false ? 'なし' : '審判音声')}</dd>
          <dt>次の的へ</dt><dd>${st.interval ?? '−'}秒${st.random && st.randomMax ? `(+最大${st.randomMax}秒ランダム)` : ''}</dd>
          <dt>5枚ごと</dt><dd>${st.rowGap ?? '−'}秒${st.random && st.rowRandomMax ? `(+最大${st.rowRandomMax}秒ランダム)` : ''}</dd>
        </dl>
      </div>`;
    root.querySelector('.h-grid').appendChild(createPlateGrid({ plates: s.plates, readonly: true }).root);
    root.querySelector('.h-del').addEventListener('click', () => {
      if (!confirm(`${longDate(s.date)} ${s.time} のセットを削除します。よろしいですか?`)) return;
      deleteSet(s.id);
      toast('削除しました');
      location.hash = '#/history';
    });
    root.querySelector('.h-editnote').addEventListener('click', () => {
      const next = prompt('メモ', s.note || '');
      if (next == null) return;
      updateSet(s.id, { note: next.trim().slice(0, 200) });
      renderDetail(s.id);
    });
  }

  async function exportCsv() {
    const sets = loadSets();
    if (!sets.length) { toast('書き出す記録がありません', 'warn'); return; }
    const file = new File([toCsv(sets)], `aps-plate-${dateStr()}.csv`, { type: 'text/csv' });
    const how = await shareOrDownload(file, 'APSプレートタイマー 履歴');
    if (how === 'download') toast('CSVをダウンロードしました');
  }

  return {
    root,
    show(id) { if (id) renderDetail(id); else renderList(); },
  };
}
