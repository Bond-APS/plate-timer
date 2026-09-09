/* 端末内保存(localStorage)。サーバーもログインも無し。
   sets: 練習セットの配列(新しい順)。settings: 既定値・音量・マイク計測の記憶。
   スキーマ(1セット):
   { id, date:"2026-09-10", time:"20:15", plates:["hit"|"miss"×15], reactions:[秒|null×15],
     direction:"ltr"|"rtl", settings:{voice,interval,rowGap,random,randomMax,rowRandomMax}, note:"" }
   plates は物理位置(0-4=下段左→右…)、reactions は撃順。direction(射撃方向指定、v1.3〜)が無い旧セットは ltr 扱い。
   (v1.0で保存したセットの settings には useVoices/startDelay が残るが無害) */
import { PANEL_DEFAULTS } from './components/platepanel.js';
import { DEFAULT_GAINS } from './components/audiotimer.js';
import { plateRhythm, hitCount, plateDirection } from './logic/rhythm.js';

const KEY_SETS = 'aps-plate-timer:sets';
const KEY_SETTINGS = 'aps-plate-timer:settings';
export const SCHEMA_VERSION = 1;

export const DEFAULT_SETTINGS = {
  timer: { ...PANEL_DEFAULTS },
  live: false,          // 前回マイク計測をONにしていたか
  direction: 'ltr',     // 前回選んだ射撃方向(結果入力の初期値)
  history: {            // 履歴画面の表示範囲(v1.4)
    trend: 'sets5',     // セット別の反応時間: 'sets5'(直近5セット) | 'week'(直近1週間・日別) | 'months6'(直近6か月・月別)
    range: { mode: 'sets', n: 5, weeks: 4, from: '', to: '' }, // ターゲット別・ヒット率の集計範囲
  },
  micGuideSeen: false,  // 初回のマイク案内を閉じたか
  gains: { ...DEFAULT_GAINS },
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
}

export function newId() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${Math.random().toString(36).slice(2, 8)}`;
}

/* ---------- セット ---------- */
export function loadSets() {
  const arr = read(KEY_SETS, []);
  return Array.isArray(arr) ? arr.filter(isValidSet).sort(byNewest) : [];
}
export function saveSets(sets) { return write(KEY_SETS, sets); }
export function addSet(set) {
  const sets = loadSets();
  sets.unshift(set);
  sets.sort(byNewest);
  return saveSets(sets);
}
export function updateSet(id, patch) {
  const sets = loadSets();
  const i = sets.findIndex((s) => s.id === id);
  if (i < 0) return false;
  sets[i] = { ...sets[i], ...patch };
  return saveSets(sets);
}
export function deleteSet(id) {
  return saveSets(loadSets().filter((s) => s.id !== id));
}
export function clearAll() {
  try { localStorage.removeItem(KEY_SETS); localStorage.removeItem(KEY_SETTINGS); } catch (e) { /* 無視 */ }
}

function byNewest(a, b) { return (b.date + b.time + b.id).localeCompare(a.date + a.time + a.id); }

export function isValidSet(s) {
  return s && typeof s.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')
    && Array.isArray(s.plates) && s.plates.length === 15;
}
function normalizeSet(s) {
  return {
    id: String(s.id),
    date: s.date,
    time: typeof s.time === 'string' ? s.time : '',
    plates: s.plates.map((p) => (p === 'hit' ? 'hit' : 'miss')),
    reactions: Array.from({ length: 15 }, (_, i) => {
      const r = Array.isArray(s.reactions) ? s.reactions[i] : null;
      return typeof r === 'number' && Number.isFinite(r) ? Math.round(r * 100) / 100 : null;
    }),
    direction: plateDirection(s),
    settings: s.settings && typeof s.settings === 'object' ? s.settings : {},
    note: typeof s.note === 'string' ? s.note : '',
  };
}

/* ---------- 設定 ---------- */
export function loadSettings() {
  const s = read(KEY_SETTINGS, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    timer: { ...DEFAULT_SETTINGS.timer, ...(s.timer || {}) },
    gains: { ...DEFAULT_SETTINGS.gains, ...(s.gains || {}) },
    history: { ...DEFAULT_SETTINGS.history, ...(s.history || {}), range: { ...DEFAULT_SETTINGS.history.range, ...(s.history?.range || {}) } },
  };
}
export function saveSettings(patch) {
  const cur = loadSettings();
  const next = { ...cur, ...patch };
  if (patch.timer) next.timer = { ...cur.timer, ...patch.timer };
  if (patch.gains) next.gains = { ...cur.gains, ...patch.gains };
  if (patch.history) next.history = { ...cur.history, ...patch.history, range: { ...cur.history.range, ...(patch.history.range || {}) } };
  write(KEY_SETTINGS, next);
  return next;
}

/* ---------- 書き出し・読み込み ---------- */
const ROW_LABELS = ['下', '中', '上'];

/* 1行=1セットの横長CSV(UTF-8 BOM付き。Excelで文字化けしない) */
export function toCsv(sets) {
  const head = ['日付', '時刻', '射撃方向', 'ヒット数', '平均反応秒', '標準偏差', '3秒超過枚数', '計測枚数', 'メモ',
    ...Array.from({ length: 15 }, (_, i) => `${ROW_LABELS[Math.floor(i / 5)]}${(i % 5) + 1}`),
    ...Array.from({ length: 15 }, (_, i) => `反応${i + 1}`)];
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [...sets].sort((a, b) => -byNewest(a, b)).map((s) => {
    const r = plateRhythm(s.reactions);
    return [s.date, s.time, plateDirection(s) === 'rtl' ? '右から左' : '左から右', hitCount(s.plates), r ? r.avg.toFixed(2) : '', r ? r.sd.toFixed(2) : '', r ? r.over : '', r ? r.n : 0, s.note || '',
      ...s.plates.map((p) => (p === 'hit' ? 1 : 0)),
      ...s.reactions.map((v) => (v == null ? '' : v.toFixed(2)))].map(q).join(',');
  });
  return '﻿' + [head.join(','), ...rows].join('\r\n') + '\r\n';
}

export function toBackupJson() {
  return JSON.stringify({ app: 'aps-plate-timer', schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), settings: loadSettings(), sets: loadSets() }, null, 1);
}

/* バックアップJSONを読み込み、idで重複を除いて統合。追加件数を返す */
export function importBackupJson(text) {
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('JSONとして読めません'); }
  const incoming = Array.isArray(data?.sets) ? data.sets : Array.isArray(data) ? data : null;
  if (!incoming) throw new Error('このアプリのバックアップ形式ではありません');
  const cur = loadSets();
  const ids = new Set(cur.map((s) => s.id));
  let added = 0;
  for (const raw of incoming) {
    if (!isValidSet(raw) || ids.has(raw.id)) continue;
    cur.push(normalizeSet(raw));
    ids.add(raw.id);
    added++;
  }
  cur.sort(byNewest);
  saveSets(cur);
  if (data?.settings && typeof data.settings === 'object') {
    const { timer, gains, live, direction } = data.settings;
    saveSettings({ ...(timer ? { timer } : {}), ...(gains ? { gains } : {}), ...(typeof live === 'boolean' ? { live } : {}),
      ...(direction === 'ltr' || direction === 'rtl' ? { direction } : {}) });
  }
  return added;
}
