# Browser DAW

## 日本語

Browser DAWは、Web Audio APIだけで動く、依存関係ゼロの音楽制作ワークスペースです。マルチトラック編集、ピアノロール、ステップシーケンサー、ミキサー、内蔵音源とエフェクト、WAV・MP3・MIDI書き出しを一つの静的Webアプリにまとめています。

### 主な機能

- マルチトラックの配置、ループ、分割、フェード
- ピアノロール、ステップシーケンサー、アルペジエーター
- 減算合成、FM、物理モデリング、ウェーブテーブル、ドラム音源
- チャンネルEQ、インサート、リバーブ/ディレイ送信、マスタリング
- MIDI入力、キーボード演奏、録音、オーディオ解析
- プロジェクトJSONとWAV・MP3・MIDI・ステムの書き出し
- ブラウザ内で完結し、サーバーへのデータ送信なし

### 起動

最も簡単な方法は`index.html`をChromium系ブラウザで開くことです。アプリモード用ランチャーも用意しています。

macOS:

```bash
chmod +x browser-daw.command
./browser-daw.command
```

Linux:

```bash
chmod +x browser-daw.sh
./browser-daw.sh
```

Windowsでは`browser-daw.bat`を実行します。

ブラウザの制約により、ネイティブのVST3/AUプラグインは読み込めません。内蔵音源とWeb Audioエフェクトを使用します。音声出力を開始するには、起動画面でユーザー操作が必要です。

### 検証

Node.js 20以降で次を実行します。

```bash
npm test
```

テストは全JavaScriptの構文と、HTMLから参照されるローカルスクリプトを検証します。

### データと安全性

プロジェクトと設定はブラウザ内またはユーザーが保存したファイルにのみ保持されます。この公開版には制作中のMIDI、音声、個人プロジェクト、旧Git履歴を含めていません。

## English

Browser DAW is a dependency-free music-production workspace built entirely on the Web Audio API. It combines multitrack editing, a piano roll, step sequencing, a mixer, built-in instruments and effects, and WAV, MP3, and MIDI export in one static web application.

### Key features

- Multitrack arrangement, looping, splitting, and fades
- Piano roll, step sequencer, and arpeggiator
- Subtractive, FM, physical-modeling, wavetable, and drum instruments
- Channel EQ, inserts, reverb/delay sends, and mastering
- MIDI input, computer-keyboard performance, recording, and audio analysis
- Project JSON plus WAV, MP3, MIDI, and stem export
- Fully browser-local operation with no data sent to a server

### Run

The simplest option is to open `index.html` in a Chromium-based browser. App-mode launchers are also included.

macOS:

```bash
chmod +x browser-daw.command
./browser-daw.command
```

Linux:

```bash
chmod +x browser-daw.sh
./browser-daw.sh
```

On Windows, run `browser-daw.bat`.

Browser restrictions prevent loading native VST3/AU plug-ins. Use the built-in instruments and Web Audio effects. Starting audio output requires a user gesture on the launch screen.

### Verification

With Node.js 20 or later, run:

```bash
npm test
```

The tests validate JavaScript syntax and every local script referenced by the HTML.

### Data and safety

Projects and settings remain in the browser or in files explicitly saved by the user. This public edition includes no work-in-progress MIDI, audio, personal projects, or previous Git history.

## License

Original project code is MIT licensed. The separately bundled `js/vendor/lame.min.js` is licensed under LGPL-3.0; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [LICENSES/LGPL-3.0.txt](LICENSES/LGPL-3.0.txt).
