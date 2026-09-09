/* 履歴画面: セット一覧・グラフ2つ・セット詳細・CSV書き出し */
import { el, esc, shortDate, longDate, toast, dateStr, shareOrDownload } from '../util.js';
import { loadSets, deleteSet, updateSet, toCsv } from '../store.js';
import { plateRhythm, rhythmLabel, hitCount, perPlateAverage, setSeries, plateShots, plateDirection, PLATE_DIRECTIONS, perOrderStats, binHitRates, hitMissReaction, MIN_REACTION } from '../logic/rhythm.js';
import { rhythmTrendSvg, perPlateSvg, rateBarsSvg } from '../components/charts.js';
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

    // タイミングとヒット/ミスの関係(マイク計測のあるセットすべて。撃順は射撃方向を解いてから数える)
    const measuredAll = sets.filter((s) => plateRhythm(s.reactions));
    const order = perOrderStats(measuredAll);
    const orderSvg = rateBarsSvg(order.map((o, i) => ({
      label: String(i + 1),
      rate: o.count ? Math.round((o.hit / o.count) * 100) : null,
      low: o.count ? o.hit / o.count < 0.8 : false,
      title: `${i + 1}枚目: ヒット ${o.hit}/${o.count}${o.avg != null ? ` ・ 平均${o.avg.toFixed(2)}s` : ''}`,
    })), { plateRows: true });
    const bins = binHitRates(measuredAll);
    const binSvg = rateBarsSvg(bins.map((b) => ({
      label: b.label,
      rate: b.n ? Math.round((b.hit / b.n) * 100) : null,
      low: b.key === 'over',
      title: `${b.label}: ヒット ${b.hit}/${b.n}枚`,
    })));
    const hm = hitMissReaction(measuredAll);
    const hmParts = [`${measuredAll.length}セット・${hm.shots}枚`];
    if (hm.hits.n) hmParts.push(`ヒット時 平均${hm.hits.avg.toFixed(2)}s ±${hm.hits.sd.toFixed(2)}(${hm.hits.n}枚)`);
    if (hm.misses.n) hmParts.push(`ミス時 平均${hm.misses.avg.toFixed(2)}s ±${hm.misses.sd.toFixed(2)}(${hm.misses.n}枚)`);
    if (hm.undetected) hmParts.push(`未検出 ${hm.undetected}枚`);
    if (hm.suspect) hmParts.push(`${MIN_REACTION}秒未満の誤検出疑い ${hm.suspect}枚は未検出扱い`);

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
      ${perPlate ? `<div class="card"><h2>撃順別の平均反応時間<span class="h2-side">1〜15枚目・直近${measured.length}セット</span></h2>${perPlate}
        <div class="chart-legend">何枚目で遅れるかの目安。撃順は射撃方向(→/←)を解いて数えます。段の継ぎ目(5・10枚目)は点線で区切っています。</div></div>` : ''}
      ${orderSvg ? `<div class="card"><h2>撃順別のヒット率<span class="h2-side">マイク計測のある${measuredAll.length}セット</span></h2>${orderSvg}
        <div class="chart-legend">赤い棒はヒット率80%未満。反応が遅れる枚とミスが出る枚が重なるかを見ます。棒を長押しすると枚数と平均反応時間が出ます。</div></div>` : ''}
      ${binSvg ? `<div class="card"><h2>反応時間とヒット率<span class="h2-side">帯ごとのヒット率</span></h2>${binSvg}
        <div class="chart-legend">${esc(hmParts.join(' / '))}。2.95〜3.30秒は終了ブザーと重なり検出できないため「未検出」に入ります。</div></div>` : ''}
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
