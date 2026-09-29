/* ══════════════════════════════════════════════════════════════
   menus.js — メニューバー / コンテキストメニュー / ダイアログ
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Menus = {
  defs: {
    file: () => [
      { label: '新規プロジェクト', key: U.isMac ? '⌘N' : 'Ctrl+N', fn: () => App.newProject() },
      { label: 'デモソングを開く', fn: () => App.loadDemo() },
      { sep: true },
      { label: 'オーディオファイルを読み込む…', key: U.isMac ? '⇧⌘I' : 'Ctrl+Shift+I', fn: () => App.openAudioDialog() },
      { sep: true },
      { label: 'プロジェクトを開く…', key: U.isMac ? '⌘O' : 'Ctrl+O', fn: () => App.openProjectFile() },
      { label: 'プロジェクトを保存', key: U.isMac ? '⌘S' : 'Ctrl+S', fn: () => App.saveProject() },
      { label: 'ブラウザに保存 (自動復元用)', fn: () => App.saveLocal() },
      { label: 'ブラウザ保存から復元', fn: () => App.loadLocal() },
      { sep: true },
      { label: 'オーディオを書き出す (WAV / MP3)…', key: U.isMac ? '⌘E' : 'Ctrl+E', fn: () => App.exportDialog() },
      { label: 'MIDI ファイルを書き出す…', fn: () => App.exportMidi() },
      { sep: true },
      { label: 'オーディオ設定 (サンプルレート / レイテンシ)…', fn: () => App.audioPrefsDialog() },
      { label: 'MIDI 設定…', fn: () => App.midiDialog() }
    ],
    edit: () => [
      { label: '取り消し', key: U.isMac ? '⌘Z' : 'Ctrl+Z', fn: () => App.undo() },
      { label: 'やり直し', key: U.isMac ? '⇧⌘Z' : 'Ctrl+Y', fn: () => App.redo() },
      { sep: true },
      { label: 'カット', key: U.isMac ? '⌘X' : 'Ctrl+X', fn: () => App.cut() },
      { label: 'コピー', key: U.isMac ? '⌘C' : 'Ctrl+C', fn: () => App.copy() },
      { label: 'ペースト', key: U.isMac ? '⌘V' : 'Ctrl+V', fn: () => App.paste() },
      { label: '削除', key: 'Delete', fn: () => App.deleteSelection() },
      { sep: true },
      { label: 'すべて選択', key: U.isMac ? '⌘A' : 'Ctrl+A', fn: () => App.selectAll() },
      { label: '選択範囲をループに設定', key: 'U', fn: () => App.cycleToSelection() }
    ],
    track: () => [
      { label: '新規ソフトウェア音源トラック', key: U.isMac ? '⌥⌘N' : 'Ctrl+Alt+N', fn: () => App.addTrack('Classic Lead') },
      { label: '新規ドラムトラック', fn: () => App.addTrack('Acoustic Kit') },
      { label: '新規 SPECTRA トラック', fn: () => App.addTrack('Neon Supersaw') },
      { label: '新規オーディオトラック', fn: () => App.addAudioTrack() },
      { label: 'トラックを追加…', fn: () => App.addTrackDialog() },
      { sep: true },
      { label: '選択トラックを複製', key: U.isMac ? '⌘D' : 'Ctrl+D', fn: () => App.duplicateTrack() },
      { label: '選択トラックを削除', fn: () => App.deleteSelectedTracks() },
      { sep: true },
      { label: 'すべてのミュートを解除', fn: () => App.clearAll('mute') },
      { label: 'すべてのソロを解除', fn: () => App.clearAll('solo') }
    ],
    region: () => [
      { label: '再生ヘッド位置で分割', key: U.isMac ? '⌘T' : 'Ctrl+T', fn: () => App.splitAtPlayhead() },
      { label: '選択リージョンを結合', key: U.isMac ? '⌘J' : 'Ctrl+J', fn: () => App.glueSelection() },
      { label: '複製', key: U.isMac ? '⌘D' : 'Ctrl+D', fn: () => App.duplicateRegions() },
      { sep: true },
      { label: 'ループ ×2', fn: () => App.regionOp(r => r.loop = (r.loop || 0) + 1) },
      { label: 'ループを解除', fn: () => App.regionOp(r => r.loop = 0) },
      { label: 'ミュート切り替え', key: 'M', fn: () => App.regionOp(r => r.mute = !r.mute) },
      { sep: true },
      { label: '1オクターブ上げる', fn: () => App.regionOp(r => r.transpose = (r.transpose || 0) + 12) },
      { label: '1オクターブ下げる', fn: () => App.regionOp(r => r.transpose = (r.transpose || 0) - 12) },
      { label: 'ピアノロールで開く', key: 'P', fn: () => App.openSelectedRegion() },
      { sep: true },
      { title: 'MIDI 処理' },
      { label: 'アルペジエータ…', key: 'A', fn: () => App.arpDialog() },
      { sep: true },
      { title: 'オーディオ処理' },
      { label: '小節に合わせる (タイムストレッチ)…', key: 'G', fn: () => App.fitToBarsDialog() },
      { label: 'ステム分割 (ドラム/ベース/ボーカル/その他)…', fn: () => App.stemsDialog() },
      { label: '波形エディタで開く', key: 'W', fn: () => App.openSelectedRegion() }
    ],
    view: () => [
      { label: 'ミキサー', key: 'X', fn: () => App.toggleEditor('mixer') },
      { label: 'オーディオ / 波形エディタ', key: 'W', fn: () => App.toggleEditor('wave') },
      { label: 'SPECTRA を開く', key: 'S', fn: () => App.openSpectra() },
      { label: 'マスタリング', key: '⇧M', fn: () => MasteringUI.toggle() },
      { label: 'ピアノロール', key: 'P', fn: () => App.toggleEditor('pianoroll') },
      { label: 'ステップシーケンサ', key: 'B', fn: () => App.toggleEditor('stepseq') },
      { sep: true },
      { label: 'インスペクタ', key: 'I', fn: () => App.togglePane('inspector') },
      { label: 'ライブラリ', key: 'Y', fn: () => App.togglePane('library') },
      { sep: true },
      { label: '全体を表示 (ズーム調整)', key: 'Z', fn: () => App.zoomToFit() },
      { label: 'フルスクリーン', key: 'F11', fn: () => App.toggleFullscreen() }
    ],
    help: () => [
      { label: 'キーボードショートカット一覧', key: '?', fn: () => App.showShortcuts() },
      { label: 'ドラムマップ', fn: () => App.showDrumMap() },
      { label: 'レイテンシを確認', fn: () => App.showLatency() },
      { label: 'プラグインフォーマットについて', fn: () => App.showPluginInfo() },
      { label: '使い方 (クイックスタート)', fn: () => App.showGuide() },
      { sep: true },
      { label: 'Browser DAW について', fn: () => App.showAbout() }
    ]
  },

  init() {
    U.$$('#menubar .menu').forEach(m => {
      m.onclick = e => this.open(m);
      m.onmouseenter = () => { if (this._open) this.open(m); };
    });
    window.addEventListener('mousedown', e => {
      if (!e.target.closest('#menu-popup') && !e.target.closest('#menubar .menu')) this.close();
      if (!e.target.closest('#ctxmenu')) U.$('#ctxmenu').classList.add('hidden');
    });
  },

  open(m) {
    const pop = U.$('#menu-popup');
    U.$$('#menubar .menu').forEach(x => x.classList.remove('open'));
    m.classList.add('open');
    pop.innerHTML = '';
    const items = this.defs[m.dataset.menu]();
    this.fill(pop, items);
    const r = m.getBoundingClientRect();
    pop.style.left = r.left + 'px';
    pop.style.top = r.bottom + 'px';
    pop.classList.remove('hidden');
    this._open = true;
  },
  close() {
    U.$('#menu-popup').classList.add('hidden');
    U.$$('#menubar .menu').forEach(x => x.classList.remove('open'));
    this._open = false;
  },
  fill(host, items) {
    items.forEach(it => {
      if (it.sep) { host.appendChild(U.el('div', 'mp-sep')); return; }
      if (it.title) { host.appendChild(U.el('div', 'mp-title', it.title)); return; }
      const d = U.el('div', 'mp-item' + (it.dis ? ' dis' : ''));
      d.appendChild(U.el('span', null, it.label));
      if (it.key) d.appendChild(U.el('span', 'key', it.key));
      d.onclick = () => { this.close(); U.$('#ctxmenu').classList.add('hidden'); if (!it.dis) it.fn(); };
      host.appendChild(d);
    });
  }
};

/* ══════════════════ モーダル ══════════════════ */
const Modal = {
  show(title, buildBody, actions) {
    const m = U.$('#modal'), card = U.$('#modal-card');
    card.innerHTML = '';
    card.appendChild(U.el('h2', null, title));
    const body = U.el('div');
    buildBody(body);
    card.appendChild(body);
    const act = U.el('div', 'modal-actions');
    (actions || [{ label: '閉じる', primary: true }]).forEach(a => {
      const b = U.el('button', 'tb-btn' + (a.primary ? ' primary' : ''), a.label);
      b.onclick = () => { if (!a.fn || a.fn(body) !== false) Modal.hide(); };
      act.appendChild(b);
    });
    card.appendChild(act);
    m.classList.remove('hidden');
    this._esc = e => { if (e.key === 'Escape') Modal.hide(); };
    window.addEventListener('keydown', this._esc, true);
    return body;
  },
  hide() {
    U.$('#modal').classList.add('hidden');
    if (this._esc) window.removeEventListener('keydown', this._esc, true);
  }
};

window.Menus = Menus;
window.Modal = Modal;
