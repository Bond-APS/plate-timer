/* プレート実音声クリップのメタ定数(tools/analyze-clip.mjs による実測値)。
   クリップ構成: 「プレート、スタンバイ、レディー」コール → 開始ブザー → 3.00秒 → 終了ブザー。
   ブザーは基音200Hz+奇数次倍音(600/1000/1400Hz)で約1.25秒持続する。
   ※ 原録音に混入していた他選手の発砲音(5.53s)と残響(5.90s)は
      tools/clean-clip.mjs でブザー成分+ルームトーンに置換済み(原本は tools/plate-call-original.m4a) */
export const CLIP = {
  url: new URL('../../audio/plate-call.m4a', import.meta.url).href, // 相対パス(サブパス配信のGitHub Pages対応)
  duration: 8.661,   // クリップ全長(秒)
  startBuzzer: 4.31, // 開始ブザー立ち上がり(秒)
  endBuzzer: 7.31,   // 終了ブザー立ち上がり(秒)
  buzzerGap: 3.0,    // 開始→終了ブザーの実測間隔(=射撃時間)
  buzzerFreq: 200,   // ブザー基音(Hz)。録音解析のバンドパス中心
  buzzerDur: 1.3,    // ブザー持続(秒)。発砲はブザー鳴動中に起きる
  buzzerMask: 0.3,   // 発砲検出でブザー立ち上がりを除外するマスク長(秒)
};
