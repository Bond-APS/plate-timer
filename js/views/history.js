/* 履歴画面: セット一覧・グラフ・セット詳細・CSV書き出し
   グラフの表示範囲(v1.4):
   - セット別の反応時間: 直近5セット / 直近1週間(日別平均) / 直近6か月(月別平均)
   - ターゲット別の平均反応時間・撃順別のヒット率・反応時間ごとのヒット率: 共通の集計範囲
     (直近○セット / 直近○週間 / 期間指定=開始日〜終了日)。選択は settings.history に記憶 */
import { el, esc, shortDate, longDate, toast, dateStr, shareOrDownload } from '../util.js';
import { loadSets, deleteSet, updateSet, toCsv, loadSettings, saveSettings } from '../store.js';
import {
  plateRhythm, rhythmLabel, hitCount, perPlateAverage, setSeries, plateShots, plateDirection, PLATE_DIRECTIONS,
  perOrderStats, hitMissReaction, MIN_REACTION, dailySeries, monthlySeries, filterSetsByRange, hitRateGroups,
} from '../logic/rhythm.js';
import { rhythmTrendSvg, perPlateSvg, rateBarsSvg } from '../components/charts.js';
import { createPlateGrid } from '../components/plategrid.js';
import { VOICE_LABELS } from '../components/platepanel.js';

const TREND_SETS = 5;
const TREND_MODES = [
  { key: 'sets5', label: '直近5セット' },
  { key: 'week', label: '直近1週間' },
  { key: 'months6', label: '直近6か月' },
];
const RANGE_MODES = [
  { key: 'sets', label: '直近○セット' },
  { key: 'weeks', label: '直近○週間' },
  { key: 'range', label: '期間の指定' },
];

export function createHistoryView() {
  const root = el('<div></div>');

  /* 集計範囲の説明文(見出しの右側) */
  function rangeText(range, n) {
    if (range.mode === 'weeks') return `直近${range.weeks}週間・${n}セット`;
    if (range.mode === 'range') return `${range.from ? shortDate(range.from) : '…'}〜${range.to ? shortDate(range.to) : '…'}・${n}セット`;
    return `直近${n}セット`;
  }

  function renderList() {
    const sets = loadSets();
    if (!sets.length) {
      root.innerHTML = `<div class="card"><div class="empty">まだ記録がありません。<br>タイマーで15枚撃って「保存」すると、ここに並びます。</div></div>`;
      return;
    }
    const today = dateStr();
    const hist = loadSettings().history;
    const range = { ...hist.range };

    /* ---- 概要(直近5セット) ---- */
    const recent = sets.slice(0, TREND_SETS);
    const allR = recent.flatMap((s) => s.reactions);
    const overall = plateRhythm(allR);
    const avgHits = recent.reduce((a, s) => a + hitCount(s.plates), 0) / recent.length;

    /* ---- セット別の反応時間: 直近5セット / 日別 / 月別 ---- */
    let trendSeries;
    let trendNote;
    if (hist.trend === 'week') {
      trendSeries = dailySeries(sets, 7, today);
      trendNote = '日ごとの平均±標準偏差(その日の全セットをまとめて計算)。記録の無い日は空欄。';
    } else if (hist.trend === 'months6') {
      trendSeries = monthlySeries(sets, 6, today);
      trendNote = '月ごとの平均±標準偏差(その月の全セットをまとめて計算)。記録の無い月は空欄。';
    } else {
      trendSeries = setSeries(recent, TREND_SETS);
      trendNote = '帯は平均±標準偏差。点が赤いセットは平均が3秒を超えています。';
    }
    const trend = rhythmTrendSvg(trendSeries);

    /* ---- 共通の集計範囲(ターゲット別・ヒット率) ---- */
    const inRange = filterSetsByRange(sets, { mode: range.mode, n: range.mode === 'weeks' ? range.weeks : range.n, from: range.from, to: range.to }, today);
    const measured = inRange.filter((s) => plateRhythm(s.reactions));
    const perPlate = perPlateSvg(perPlateAverage(measured));
    const order = perOrderStats(inRange);
    const orderSvg = rateBarsSvg(order.map((o, i) => ({
      label: String(i + 1),
      rate: o.count ? Math.round((o.hit / o.count) * 100) : null,
      low: o.count ? o.hit / o.count < 0.8 : false,
      title: `${i + 1}枚目: ヒット ${o.hit}/${o.count}${o.avg != null ? ` ・ 平均${o.avg.toFixed(2)}s` : ''}`,
    })), { plateRows: true });
    const hg = hitRateGroups(inRange);
    const groupSvg = rateBarsSvg(hg.groups.map((g) => ({
      label: g.label,
      rate: g.n ? Math.round((g.hit / g.n) * 100) : null,
      value: g.n ? `${g.hit}/${g.n}` : null,
      low: false,
      title: `${g.label}: ヒット ${g.hit}/${g.n}枚`,
    })));
    const hm = hitMissReaction(measured);
    const hmParts = [];
    if (hm.hits.n) hmParts.push(`ヒット時 平均${hm.hits.avg.toFixed(2)}s ±${hm.hits.sd.toFixed(2)}(${hm.hits.n}枚)`);
    if (hm.misses.n) hmParts.push(`ミス時 平均${hm.misses.avg.toFixed(2)}s ±${hm.misses.sd.toFixed(2)}(${hm.misses.n}枚)`);
    if (hg.undetected) hmParts.push(`未検出 ${hg.undetected}枚は群に入れていません`);
    if (hm.suspect) hmParts.push(`${MIN_REACTION}秒未満の誤検出疑い ${hm.suspect}枚は未検出扱い`);
    const rangeLabel = rangeText(range, inRange.length);

    const seg = (cls, modes, active) => `<span class="seg ${cls}">${modes.map((m) => `<button type="button" data-k="${m.key}" class="${m.key === active ? 'active' : ''}">${m.label}</button>`).join('')}</span>`;
    const rangeInputs = range.mode === 'weeks'
      ? `<span class="rc-inputs">直近 <input type="number" class="rc-weeks" min="1" max="52" inputmode="numeric" value="${range.weeks}"> 週間</span>`
      : range.mode === 'range'
        ? `<span class="rc-inputs"><input type="date" class="rc-from" value="${esc(range.from || '')}" max="${today}"> 〜 <input type="date" class="rc-to" value="${esc(range.to || '')}" max="${today}"></span>`
        : `<span class="rc-inputs">直近 <input type="number" class="rc-n" min="1" max="500" inputmode="numeric" value="${range.n}"> セット</span>`;

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
      <div class="card">
        <h2>セット別の反応時間<span class="h2-side">平均±ばらつき・赤線=3.0秒</span></h2>
        <div class="range-ctl">${seg('h-trend', TREND_MODES, hist.trend)}</div>
        ${trend || '<div class="empty">この範囲にはマイク計測のあるセットがありません</div>'}
        <div class="chart-legend">${trendNote}</div>
      </div>
      <div class="card">
        <h2>集計範囲<span class="h2-side">${esc(rangeLabel)}</span></h2>
        <div class="range-ctl">${seg('h-range', RANGE_MODES, range.mode)}${rangeInputs}</div>
        <div class="chart-legend">下の3つのグラフ(ターゲット別の平均反応時間・撃順別のヒット率・反応時間ごとのヒット率)に共通の範囲です。</div>
      </div>
      <div class="card"><h2>ターゲット別の平均反応時間<span class="h2-side">1〜15枚目・${esc(rangeLabel)}</span></h2>
        ${perPlate || '<div class="empty">この範囲にはマイク計測のあるセットがありません</div>'}
        <div class="chart-legend">何枚目で遅れるかの目安。撃順は射撃方向(→/←)を解いて数えます。段の継ぎ目(5・10枚目)は点線で区切っています。</div></div>
      <div class="card"><h2>撃順別のヒット率<span class="h2-side">${esc(rangeLabel)}</span></h2>
        ${orderSvg || '<div class="empty">この範囲にセットがありません</div>'}
        <div class="chart-legend">赤い棒はヒット率80%未満。反応が遅れる枚とミスが出る枚が重なるかを見ます。棒を長押しすると枚数と平均反応時間が出ます。</div></div>
      <div class="card"><h2>反応時間ごとのヒット率<span class="h2-side">ヒット数/射撃数・${esc(rangeLabel)}</span></h2>
        ${groupSvg || '<div class="empty">この範囲にはマイク計測のあるセットがありません</div>'}
        <div class="chart-legend">${esc(hmParts.join(' / '))}${hmParts.length ? '。' : ''}2.95〜3.30秒は終了ブザーと重なり検出できないため「未検出」になります。</div></div>
      <div class="card">
        <h2>セット一覧<span class="h2-side"><button class="btn sm h-csv">CSV書き出し</button></span></h2>
        <div class="set-list">${sets.map(itemHtml).join('')}</div>
      </div>`;
    root.querySelector('.h-csv').addEventListener('click', exportCsv);

    /* 表示範囲の切替(選択は設定に記憶し、画面を描き直す) */
    root.querySelector('.h-trend').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      saveSettings({ history: { trend: b.dataset.k } });
      renderList();
    });
    root.querySelector('.h-range').addEventListener('click', (e) => {
      const b = e.target.closest('[data-k]');
      if (!b) return;
      saveSettings({ history: { range: { mode: b.dataset.k } } });
      renderList();
    });
    const onNum = (cls, key, min, max) => {
      const inp = root.querySelector(cls);
      if (!inp) return;
      inp.addEventListener('change', () => {
        const v = Math.min(max, Math.max(min, Math.round(Number(inp.value) || min)));
        saveSettings({ history: { range: { [key]: v } } });
        renderList();
      });
    };
    onNum('.rc-n', 'n', 1, 500);
    onNum('.rc-weeks', 'weeks', 1, 52);
    for (const [cls, key] of [['.rc-from', 'from'], ['.rc-to', 'to']]) {
      const inp = root.querySelector(cls);
      if (!inp) continue;
      inp.addEventListener('change', () => {
        saveSettings({ history: { range: { [key]: inp.value || '' } } });
        renderList();
      });
    }
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
        <div class="reaction-chips">${s.reactions.some((v) => v != null) ? plateShots(s).map((sh) => {
          const res = `<span class="rc-res">${sh.hit ? '○' : '✕'}</span>`;
          const cls = sh.hit ? 'res-hit' : 'res-miss';
          if (sh.suspect) return `<span class="reaction-chip miss ${cls}" title="${MIN_REACTION}秒未満はブザーの誤検出として集計から外します">${res}${sh.order}: 誤検出</span>`;
          if (sh.reaction == null) return `<span class="reaction-chip miss ${cls}">${res}${sh.order}: −</span>`;
          return `<span class="reaction-chip ${sh.reaction > 3 ? 'over' : 'ok'} ${cls}">${res}${sh.order}: ${sh.reaction.toFixed(2)}s</span>`;
        }).join('') : ''}</div>
        <div class="small muted mt8" style="text-align:center">番号は撃順(下段→中段→上段、各段は${plateDirection(s) === 'rtl' ? '右から左' : '左から右'})。○=ヒット ✕=ミス</div>
      </div>
      <div class="card">
        <h2>メモ<span class="h2-side"><button class="btn sm h-editnote">編集</button></span></h2>
        <div class="detail-note h-note">${s.note ? esc(s.note) : '<span class="muted">(なし)</span>'}</div>
      </div>
      <div class="card soft">
        <h2>このセットの設定</h2>
        <dl class="kv">
          <dt>射撃方向</dt><dd>${PLATE_DIRECTIONS[plateDirection(s)]}</dd>
          <dt>音声</dt><dd>${VOICE_LABELS[st.voice] || (st.useVoices === false ? 'なし' : '審判音声')}</dd>
          <dt>次の的へ</dt><dd>${st.interval ?? '−'}秒${st.random && st.randomMax ? `(+最大${st.randomMax}秒ランダム)` : ''}</dd>
          <dt>5枚ごと</dt><dd>${st.rowGap ?? '−'}秒${st.random && st.rowRandomMax ? `(+最大${st.rowRandomMax}秒ランダム)` : ''}</dd>
        </dl>
      </div>`;
    root.querySelector('.h-grid').appendChild(createPlateGrid({ plates: s.plates, direction: plateDirection(s), readonly: true }).root);
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
