# APSプレートタイマー — 開発メモ

APSカップ ハンドガン部門「プレート」種目の自宅練習用Webアプリ。射撃ノート(`../射撃ノート/`、本番アプリ・変更禁止)のプレートタイマー機能を切り出し、個人データと専用サーバーを外して仲間に配れる単体アプリにしたもの。
**応答・コメント・コミットメッセージは日本語。**

## 構成(静的ファイルのみ・ビルド無し・依存パッケージ無し・ES modules)

```
index.html              1ページSPA(タブ3つ: タイマー / 履歴 / 設定)
manifest.webmanifest    PWA(start_url・scope は "./" — サブパス配信対応)
sw.js                   Service Worker(事前キャッシュ。VERSION を上げると更新される)
css/style.css           配色・タイマー/グリッド/チップの見た目は射撃ノート流用
js/app.js               ルーター。3画面は最初に1回だけ組み立て、hidden の付け外しで切替(タイマーを止めないため)
js/util.js              el/esc/toast/日付/isStandalone/shareOrDownload(共有シート or ダウンロード)
js/store.js             localStorage(aps-plate-timer:sets / :settings)・CSV・JSONバックアップ
js/views/timer.js       マイク案内カード → タイマーパネル(設定値は設定画面から) → 結果入力(グリッド+メモ) → 保存
js/views/history.js     一覧・グラフ2つ・詳細(削除/メモ編集)・CSV書き出し
js/views/settings.js    音量バランス・タイマー設定(音声セット/インターバル/ランダム)・データ(バックアップ/全削除)・使い方・環境表示
js/components/audiotimer.js   実音声タイマー本体(射撃ノート流用)
js/components/livedetect.js   マイクのライブ発砲検出(流用)
js/components/shot-worklet.js AudioWorkletProcessor(流用)
js/components/platepanel.js   タイマーパネルUI(流用+小さな追加)
js/components/plategrid.js    3段×5枚グリッド(流用+readonly)
js/components/reactiontable.js 反応時間の表(3段×5枚。タイマー実行中と結果入力で共用・v1.7)
js/components/timer.js        タイマー登録簿・合成音フォールバック(流用。StageTimerは削除)
js/components/charts.js       履歴グラフ(SVG手書き)
js/logic/plateclip.js         クリップ実測定数(流用)
js/logic/rhythm.js            反応時間の集計(射撃ノート score.js の plateRhythm を切り出し)
js/logic/shotanalysis.js      録音の事後解析(純関数・流用。初版ではUI無し。Node検算のみ)
audio/                  plate-call.m4a(競技実音声)・ref-{opening,break,finish}.m4a(審判録音)・ai-male/ ai-female/(AI音声版、同名ファイル。詳細は audio/README.md)・keepalive.mp4(無音)
icons/                  icon.svg / icon-192.png / icon-512.png / apple-touch-icon.png(的ボタンを模した縦長の楕円+緑のヒットリング。v1.4.2で同心円から変更。Python標準ライブラリで生成)
tools/                  Node検算・開発サーバー
```

データのスキーマ(1セット): `{ id, date:"2026-09-10", time:"20:15", plates:["hit"|"miss"×15], reactions:[秒|null×15], direction:"ltr"|"rtl", settings:{voice,interval,rowGap,random,randomMax,rowRandomMax}, note }`(v1.0のセットには useVoices/startDelay が残るが無害)。**plates は物理位置**(0-4=下段左→右、5-9=中段、10-14=上段)、**reactions は撃順**(1枚目→15枚目)。`direction`(v1.3、公式ルールの射撃方向指定。→=ltr 左から右、←=rtl 右から左。無い旧セットは ltr)で両者を結ぶ。対応を解くのは `logic/rhythm.js` の `plateIndexOfShot`/`plateShots` だけ。1.5秒未満の反応時間は挙銃時間より短く物理的に発砲ではない(ブザー誤検出)ので `MIN_REACTION` で集計から外し「誤検出」表示にする(保存値は変えない)。

## 流用コードに加えた変更(音声・マイク・ロックの挙動は変えていない)

- 音声・worklet・無音メディアのURLを絶対パス(`/audio/…`)から `new URL('…', import.meta.url)` の相対解決へ(GitHub Pagesのサブパス配信のため)。
- `livedetect.js` のエラー文からTailscaleのURLを削除して一般的な案内に。
- `audiotimer.js`: `setGains({clip, voice})` を追加(設定画面の音量バランス。既定値は元の CLIP_GAIN=0.5・録音等倍)。審判録音用の GainNode を1つ追加しただけ。
- `platepanel.js`: 設定UI(開始まで・インターバル・ランダム・審判音声チェック)をパネルから撤去し、設定画面の値を `defaults`/`panel.api.setSettings()` で受け取る(v1.1)。審判音声は常に使用(`useVoices=true`固定。`startDelay` は冒頭音声が読めないときだけ使う内部値)。`onStart`/`onDone`(画面通知)・`onLiveChange(on, err)`(マイクON/OFFの記憶)・`panel.api`(getSettings/setSettings/setLive/isLive/isRunning/getReactions/stop)を追加。`setLive(true)` はチェックを入れて change を同期発火するだけで、マイク取得は元の change ハンドラ経路。
- `platepanel.js`(v1.2.1): `panel.api.clearResults()` を追加。終了後の表示(「終了」・反応時間チップ・平均)を待機中に戻すだけ(マイク・音声セッションには触れない)。タイマー画面は保存/破棄の直後に呼び、履歴からタイマーへ戻ったとき前回の結果が残らないようにしている。
- `audiotimer.js`: 音声セット `setVoiceSet('referee'|'ai-male'|'ai-female')` を追加(v1.1)。AI版は `audio/<set>/ref-*.m4a`、無いスロットは審判の実録音で補う。コール(`plate-call.m4a`)とブザーは全セット共通。
- `audiotimer.js`(v1.5): 一時停止/再開(`pause()`/`resume()`)を追加。予約した音源の予定表(`planned=[{t,buffer}]`)を持ち、pause は予約を全部止めて音声時刻(`pausedAt`)を覚えるだけ、resume は予定表・進行表(`schedule`/`t0`/`nextT0`/`openingUntil`/`endAt`)を経過分だけ後ろへずらして予約し直す。**ランダム加算は作り直さない**(止めた場所の続きを鳴らすため)。鳴っている途中だったクリップは `src.start(at, offset)` で途中から続け、鳴り終わっていた音源は鳴らし直さない。再開は `RESUME_LEAD=0.25秒` 先から(予約は少し未来でないと取りこぼす)。開始ブザーがまだ先なら `onBuzzer` を再発火してライブ検出の時間窓も一緒にずらす(逆に、開始ブザーが鳴ったあと=射撃中に止めた枚は窓を取り直さない。その枚は「−」になる。ずらした時刻で測り直すと、実際に聞こえたブザーとずれた反応時間が出てしまうため)。合成音フォールバック(PlateTimer)は非対応でボタンを伏せる。
- `platepanel.js`(v1.5): 「一時停止/再開」ボタンを追加(`pause()`/`resume()` を呼ぶだけ)。一時停止中も音声セッション(キープアライブ・Wake Lock・マイク・`running` フラグ)は切らない(切ると iPhone で再開時に音が出なくなるため)。一時停止中はパート移動を伏せ、「開始」は伏せたまま(やり直しは「停止」→「開始」)。
- `platepanel.js`(v1.7、見た目のみ): タイマー本体はリングと操作ボタン(開始/一時停止/停止・パート移動)だけ。反応時間の表(`panel.parts.reactions`、マイク計測中の実行時か結果があるときだけ表示)と練習の条件(`panel.parts.info`: マイク計測スイッチ `.t-live`・設定値の要約・しきい値・警告)を別要素にし、タイマー画面が「タイマー → 反応時間 → 結果入力 → 練習の条件」の順に置く。結果入力が同じ表(ヒット/ミス付き)を出すあいだは `panel.api.setReactionsHidden(true)` で伏せる。表は `components/reactiontable.js`(実際の的の配置どおり上段→中段→下段、各マスはその的の反応時間。撃順は射撃方向から `plateIndexOfShot` で解いてマスの上に小さく出す。色は3秒超過=赤・未検出/誤検出=灰・今の枚=青枠だけ)。射撃方向は開始前に「練習の条件」の →/← で選ぶ(`settings.direction` に記憶。結果入力のグリッドの方向ボタンと双方向に同期: panel の `onDirectionChange` / `panel.api.setDirection`)。履歴の詳細は従来のチップのまま。
- `timer.js`: 未使用の StageTimer を削除。
- 発砲音の感度(v1.6): `livedetect.js` に `minDb`(コンストラクタ/`setMinDb()`)を追加。worklet が元から返しているオンセットのピークdB(`db`。2kHzハイパス後のブロックRMS、0dB=フルスケール)が `minDb` 未満なら `_onOnset` の先頭で捨てる(窓も消費しない)。null なら全部採用(テスト用。アプリでは常に数値)。`onEvent(data)` で worklet の通知をそのまま外へ渡せる。`shot-worklet.js` は port へ `{type:'meter',on:true}` を受けると約80msごとに `{type:'level', db:区間最大dB, floor}` を返す(既定OFF。検出の式は不変)。設定は `settings.mic = {minDb}`(既定 -45、常に有効。`store.js` の `micThreshold()` が範囲内の値を返す)。タイマー画面は `panel.api.setMicThreshold()` で計測中のマイクにも即反映。設定画面の「発砲音の感度調整」カードは自前の `LiveShotDetector`(onShot なし・onEvent の level だけ使う)で今の音量の横棒・最大値の目印(青)・しきい値線(赤)と数値(今/最大/しきい値)を描く。しきい値はバー上のポインタードラッグ(pointerdown/move/up、`touch-action:none`)で決め、指を離したときに保存する(スライダーは無い)。画面を離れると `hide()`(app.js の route が呼ぶ)でマイクを解放。タイマー実行中は調整不可(`isTimerRunning`)。
- `shot-worklet.js`(v1.2): 候補オンセットを150ms後に「衝撃音(onset)」と「持続音(sustained)」に分類してから通知する。加えて直前100msの最大値+6dBを超えることを候補条件に追加(持続音の中の揺れを弾く)。理由: Android Chrome では再生遅延が正しく報告されず、遅れて届いた開始ブザーが除外窓(0.3秒)の外に出て「反応0.30秒」と誤検出された(2026-09-04の報告、15枚すべて0.30〜0.31秒)。
- `livedetect.js`(v1.2): worklet の sustained 通知が予約した開始ブザーの -0.15〜+0.8秒に来たら、その時刻を反応時間と終了ブザーマスクの基準にする(聞こえなければ従来どおり予約時刻+outputLatency)。検算は `node tools/worklet-test.mjs [clip48k.wav]` と `node tools/livedetect-test.mjs`(wavは `ffmpeg -i audio/plate-call.m4a -ac 1 -ar 48000 clip48.wav` で作る)。
- これ以上、音声・マイク・ロック周りを改良したくなったら、理由を書いてユーザーに確認してから。実機で苦労して動くようになった部分。

## iPhone対策の要点(射撃ノートの技術メモから継承)

- 開始時に残り全パートの音源を AudioBufferSourceNode で一括予約(ロック中にJSが止まっても鳴り続ける)。
- `navigator.audioSession.type = 'playback'`(マイク使用中は `'play-and-record'`)、終了時に `'auto'`。
- タイマー実行中は無音メディア `audio/keepalive.mp4` を `<audio>` と `<video playsinline>` の両方でループ再生。再生開始は開始ボタンのクリック処理の同期部分で行う(await後はiOSが拒否することがある)。
- 画面ロック抑止は Wake Lock API のみ有効。**https必須**(getUserMedia も同様)。localhost はセキュアコンテキスト扱い。
- 音声クロックが1秒進まなければ中断とみなし(`STALL_SEC`)、次の「開始」で `primeAudioCtx()` が AudioContext を作り直す。音源は世代(`ctxGeneration`)ごとに再デコード(`decodeAudioData` には ArrayBuffer のコピーを渡す)。
- 反応時間 2.95〜3.30秒 は終了ブザーのマスク窓と重なり検出不能(既知の制約。UIで「−」)。
- 出力レイテンシ(Bluetooth等)は `ctx.outputLatency` で補正済み。
- Service Worker: `<audio>/<video>` は Safari が Range 要求で取りに来るので、キャッシュから返すときは 206 に切り出す(`sw.js` の `rangeFromCache`)。これが無いとキープアライブ動画が再生できない。
- ホーム画面(standalone)でマイクが使えないときのために、失敗時の案内カードで「Safariで開いて試す」を出す。Android は Chrome のサイト権限/アプリ権限の案内、LINE 等のアプリ内ブラウザ(UA判定 `inAppBrowserName()`)は最初から「Chrome/Safariで開く」を案内する。

## 検算・ローカル確認

```bash
npm test                 # audiotimer(AudioContext復旧)・shotanalysis(録音解析)・rhythm(集計/CSV)・worklet(発砲/ブザー分類)・livedetect(基準時刻の校正)
node tools/serve.mjs     # http://localhost:8765/ (Range対応の開発サーバー。python http.server は Range 非対応)
```

ブラウザで開いて console にエラーが無いこと。開発中は Service Worker のキャッシュが古いファイルを返すので、コンソールで
`navigator.serviceWorker.getRegistrations().then(r=>r.forEach(x=>x.unregister())); caches.keys().then(k=>k.forEach(x=>caches.delete(x)))`
を実行してから再読み込みする(または DevTools > Application > Service Workers > Unregister)。

`tools/analyze-clip.mjs` はクリップの再解析用(`ffmpeg -i audio/plate-call.m4a -ac 1 -ar 16000 clip.wav && node tools/analyze-clip.mjs clip.wav 200`)。

## デプロイ(GitHub Pages)

- リポジトリ: `Bond-APS/plate-timer`(公開URL `https://bond-aps.github.io/plate-timer/`)。`gh` CLI は無いので git と GitHubのWeb画面で行う。
- 初回: GitHubで空のリポジトリ `plate-timer`(Public)を作る → `git remote add origin https://github.com/Bond-APS/plate-timer.git && git push -u origin main` → GitHub の Settings > Pages > Build and deployment > Source を「Deploy from a branch」、Branch を `main` / `/ (root)` にして Save。数分で公開される。
- 更新: 変更をコミットして `git push`。**sw.js の VERSION と app.js の APP_VERSION を上げる**(上げないと既存ユーザーの端末は古いキャッシュのまま)。
- 個人情報の混入チェック: `grep -rn -i -e tsuyoshi -e 大木 -e ohki -e ito-naika -e ts.net -e 8347 js tools css index.html` が空であること。

## 表記ルール(UI文言)

「次の的へのインターバル」「5枚ごとのインターバル」(旧: インターバル / 段の間)。開始遅延と審判音声ON/OFFのUIは無し。射撃方向はグリッド下の「→ 射撃方向指定 ←」で選ぶ(v1.3。各的の上部に撃順1〜15が出て、方向で反転する。前回の選択を設定に記憶)。結果入力の説明文は「射撃方向を選択してください / ヒットした的をタップしてください」の2行だけ。的の初期状態は設定「結果入力」で すべて外れ(既定)/すべて当たり を選べ(v1.8、`settings.resultDefault`)、すべて当たりのときは2行目が「外した的をタップしてください」になる(plategrid の `setHint`)。履歴(v1.4): 「セット別の反応時間」は 直近5セット / 直近1週間(日別平均) / 直近6か月(月別平均) を切替。「ターゲット別の平均反応時間」「ターゲット別のヒット率」「反応時間ごとのヒット率(〜2.4 / 2.4〜2.7 / 2.7〜 の3群。棒の上に ヒット数/射撃数)」は共通の集計範囲(直近○セット / 直近○週間 / 期間指定=開始日・終了日)で絞る。選択は settings.history に記憶。セット詳細では射撃方向だけ後から修正できる(plategrid の directionEditable、updateSet で保存)。集計は `logic/rhythm.js` の dailySeries/monthlySeries/filterSetsByRange/hitRateGroups(純関数、rhythm-test で検算)。

## 実機(iPhone)確認の手順

1. Safariで公開URLを開く → コンソールエラー無し・音源が鳴る(サイレントスイッチON/OFF両方)。
2. 「マイクを許可して計測する」→ 許可 → 開始 → 手を叩く/空撃ちで反応時間チップが出る。
3. 共有 → ホーム画面に追加 → アイコンから起動(standalone) → 2 と同じことができる。できなければ案内カードの文言を確認。
4. タイマー中に「一時停止」→ 音が止まりリングが固まる → 少し置いて「再開」→ 止めた場所の続きから鳴り、枚数も続く(マイク計測中なら、そのあとの枚も反応時間が出る)。
5. タイマー中に画面を暗くする/ロックする → 音が最後まで鳴る。ロック解除後に「中断しました」が出た場合は「開始」で復帰する。
6. 15枚終了 → 結果入力 → 保存 → 履歴に出る。CSV書き出しで共有シートが開く。
7. 機内モードでホーム画面から起動 → 音声タイマーが動く(SWキャッシュ)。
8. 設定 → 「発砲音の感度調整」→「調整を始める」→ 手を叩く/空撃ちで横棒が振れ、「最大」の数値と青線が更新される → 赤いしきい値線をバー上でドラッグして最大より少し左に置く(ラベルの数値が追従し、離すと保存) → タイマー画面のマイク計測の注記に「しきい値 −xx dB」が出て、しきい値未満の音は反応時間に採用されない → 設定画面を離れるとマイクが解放される。
