/* livedetect.js の時間窓ゲートと基準時刻の校正の検算(Node)。
   worklet からの通知(onset/sustained)を直接流し、反応時間の計算を確かめる。
   使い方: node tools/livedetect-test.mjs */
// Node 21+ では navigator が読み取り専用の getter なので defineProperty で差し替える
Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
globalThis.window = { isSecureContext: true };
const { LiveShotDetector } = await import('../js/components/livedetect.js');
let ng = 0;
const check = (cond, msg) => { console.log(`${cond ? 'ok  ' : 'NG  '} ${msg}`); if (!cond) ng++; };
function make(lat = 0) {
  const shots = [];
  const d = new LiveShotDetector({ ctx: { outputLatency: lat }, onShot: (s) => shots.push(s) });
  d.setWindow({ plate: 1, startTime: 10.0, endTime: 13.0 });
  return { d, shots };
}
{ const { d, shots } = make(); d._onMessage({ type: 'onset', time: 12.1 });
  check(shots.length === 1 && Math.abs(shots[0].reaction - 2.1) < 1e-9 && !shots[0].over, `基本: 予約10.0・発砲12.1 → 反応2.10 (${shots[0]?.reaction})`); }
{ const { d, shots } = make(); d._onMessage({ type: 'onset', time: 10.30 });
  check(shots.length === 0, 'ブザー直後0.30秒(マスク窓の端)の onset は採用しない'); }
{ const { d, shots } = make(); d._onMessage({ type: 'onset', time: 13.1 });
  check(shots.length === 0, '終了ブザーのマスク窓(3.0〜3.3)は採用しない'); }
{ const { d, shots } = make(); d._onMessage({ type: 'onset', time: 13.4 });
  check(shots.length === 1 && shots[0].over, '3.4秒は超過として採用'); }
{ // 遅延が報告されない端末: ブザーが0.30秒遅れて聞こえる(Androidの報告の再現)
  const { d, shots } = make(0); d._onMessage({ type: 'sustained', time: 10.30 }); d._onMessage({ type: 'onset', time: 12.40 });
  check(shots.length === 1 && Math.abs(shots[0].reaction - 2.10) < 1e-9, `遅延0.30秒(未報告): 聞こえたブザー10.30を基準に 12.40 → 反応2.10 (${shots[0]?.reaction})`); }
{ const { d, shots } = make(0); d._onMessage({ type: 'sustained', time: 10.30 }); d._onMessage({ type: 'onset', time: 13.35 });
  check(shots.length === 0, '遅延0.30秒: 終了ブザーのマスクも聞こえた時刻基準(13.30〜13.60)にずれる'); }
{ const { d, shots } = make(0.2); d._onMessage({ type: 'sustained', time: 10.22 }); d._onMessage({ type: 'onset', time: 12.22 });
  check(shots.length === 1 && Math.abs(shots[0].reaction - 2.0) < 1e-9, `報告遅延0.2+実測10.22: 実測を優先して反応2.00 (${shots[0]?.reaction})`); }
{ const { d, shots } = make(0); d._onMessage({ type: 'sustained', time: 11.5 }); d._onMessage({ type: 'onset', time: 12.1 });
  check(shots.length === 1 && Math.abs(shots[0].reaction - 2.1) < 1e-9, '予約から0.8秒以上離れた持続音は基準にしない(環境音)'); }
{ const { d, shots } = make(0); d._onMessage({ type: 'sustained', time: 10.05 }); d._onMessage({ type: 'sustained', time: 10.6 }); d._onMessage({ type: 'onset', time: 12.05 });
  check(shots.length === 1 && Math.abs(shots[0].reaction - 2.0) < 1e-9, '最初に聞こえた持続音だけを基準にする'); }
{ const { d, shots } = make(); d._onMessage({ type: 'onset', time: 12.1 }); d._onMessage({ type: 'onset', time: 12.5 });
  check(shots.length === 1, '1枚につき最初の発砲だけ採用'); }
console.log(ng ? `\n${ng}件 失敗` : '\n全て合格');
process.exit(ng ? 1 : 0);
