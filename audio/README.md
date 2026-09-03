# 音声ファイル

- `plate-call.m4a` — 競技実音声(「プレート、スタンバイ、レディー」→開始ブザー→3.0秒→終了ブザー、8.661秒)。タイミング定数は `js/logic/plateclip.js`。
- `ref-opening.m4a` / `ref-break.m4a` / `ref-finish.m4a` — 審判の実録音(冒頭・段の間・終了)。-15 LUFS に正規化済み。
- `ai-male/` `ai-female/` — AI音声版。**同じファイル名**(`ref-opening.m4a` / `ref-break.m4a` / `ref-finish.m4a`)で置く。無いスロットは審判の実録音で補われる。
- `keepalive.mp4` — 無音メディア(iPhoneのバックグラウンド維持用)。

AI音声を差し替えるときの正規化コマンド(ラウドネスを審判録音と揃える):

```
ffmpeg -i 元ファイル -af "loudnorm=I=-15:TP=-1.5:LRA=11" -ar 48000 -c:a aac -b:a 96k audio/ai-male/ref-opening.m4a
```

音声ファイルはMITライセンスの対象外です(本アプリでの利用に限る)。
