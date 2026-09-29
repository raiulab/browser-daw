/* ══════════════════════════════════════════════════════════════
   inspector.js — インスペクタ (リージョン / トラック / 音源パラメータ)
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* パラメータ行ヘルパ */
function ipRange(label, val, min, max, step, onChange, fmt) {
  const row = U.el('div', 'ip-row');
  row.appendChild(U.el('label', null, label));
  const r = U.el('input'); r.type = 'range';
  r.min = min; r.max = max; r.step = step; r.value = val;
  const v = U.el('span', 'ip-val', fmt ? fmt(val) : U.round(val, 3));
  let snapped = false;
  r.oninput = e => {
    if (!snapped) { Project.snapshot(label + ' 変更'); snapped = true; }
    const nv = +e.target.value;
    v.textContent = fmt ? fmt(nv) : U.round(nv, 3);
    onChange(nv);
  };
  r.onchange = () => { snapped = false; };
  row.appendChild(r); row.appendChild(v);
  return row;
}
function ipSelect(label, val, options, onChange) {
  const row = U.el('div', 'ip-row');
  row.appendChild(U.el('label', null, label));
  const s = U.el('select');
  options.forEach(o => {
    const op = U.el('option', null, o.label || o);
    op.value = o.value != null ? o.value : o;
    if (String(op.value) === String(val)) op.selected = true;
    s.appendChild(op);
  });
  s.onchange = e => { Project.snapshot(label + ' 変更'); onChange(e.target.value); };
  row.appendChild(s);
  return row;
}
function ipText(label, val, onChange) {
  const row = U.el('div', 'ip-row');
  row.appendChild(U.el('label', null, label));
  const i = U.el('input'); i.type = 'text'; i.value = val;
  i.onchange = e => { Project.snapshot(label + ' 変更'); onChange(e.target.value); };
  i.onkeydown = e => { e.stopPropagation(); if (e.key === 'Enter') i.blur(); };
  row.appendChild(i);
  return row;
}
function ipCheck(label, val, onChange) {
  const row = U.el('div', 'ip-row');
  row.appendChild(U.el('label', null, label));
  const i = U.el('input'); i.type = 'checkbox'; i.checked = !!val;
  i.style.cssText = 'flex:0 0 auto;margin-right:auto;';
  i.onchange = e => { Project.snapshot(label + ' 変更'); onChange(e.target.checked); };
  row.appendChild(i);
  return row;
}
function ipButton(label, onClick) {
  const b = U.el('button', 'tb-btn', label);
  b.style.cssText = 'width:100%;margin-top:4px;';
  b.onclick = onClick;
  return b;
}

const Inspector = {
  render() {
    if (!Project.data) return;
    this.renderRegion();
    this.renderTrack();
    this.renderChannel();
  },

  renderRegion() {
    const host = U.$('#insp-region-body');
    host.innerHTML = '';
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) { host.appendChild(U.el('div', 'ip-empty', 'リージョン未選択')); return; }
    if (ids.length > 1) {
      host.appendChild(U.el('div', 'ip-empty', ids.length + ' 個のリージョンを選択中'));
      host.appendChild(ipButton('選択範囲にサイクルを設定', () => App.cycleToSelection()));
      return;
    }
    const f = Project.region(ids[0]); if (!f) return;
    const r = f.region;
    host.appendChild(ipText('名前', r.name, v => { r.name = v; Arrange.renderRegions(); }));

    /* ── オーディオリージョン ── */
    if (r.type === 'audio') {
      const a = AudioPool.get(r.audioId);
      const p = Project.data;
      if (a) {
        const m = a.meta || {};
        const info = U.el('div', 'ip-row');
        info.style.cssText = 'display:block;font-size:10px;color:#6b7c90;line-height:1.6;';
        info.innerHTML = (m.format || 'PCM') + ' · ' +
          (m.origRate ? (m.origRate / 1000) + ' kHz' : '') +
          (m.origBits ? ' / ' + m.origBits + ' bit' : '') + '<br>' +
          a.buffer.duration.toFixed(3) + ' 秒 · ' +
          (a.buffer.numberOfChannels === 1 ? 'モノラル' : 'ステレオ');
        host.appendChild(info);
      }
      host.appendChild(ipRange('開始 (拍)', r.start, 0, Math.max(64, r.start + 64), 0.25,
        v => { r.start = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
      host.appendChild(ipRange('長さ (拍)', r.length, 0.25, Math.max(64, r.length + 32), 0.25,
        v => { r.length = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
      host.appendChild(ipRange('オフセット (秒)', r.offset || 0, 0,
        Math.max(0.1, a ? a.buffer.duration : 1), 0.001,
        v => { r.offset = v; Arrange.renderRegions(); }, v => U.round(v, 3)));
      host.appendChild(ipRange('ゲイン', r.gain == null ? 1 : r.gain, 0, 2, 0.01,
        v => { r.gain = v; }, v => U.dbText(v) + ' dB'));
      host.appendChild(ipRange('パン', r.pan || 0, -1, 1, 0.01, v => { r.pan = v; },
        v => v === 0 ? 'C' : (v < 0 ? 'L' + Math.round(-v * 100) : 'R' + Math.round(v * 100))));
      host.appendChild(ipRange('再生速度', r.rate || 1, 0.25, 4, 0.001,
        v => { r.rate = v; Arrange.renderRegions(); },
        v => U.round(v * 100, 1) + '%  (' + ((-12 * Math.log2(1 / v)).toFixed(2)) + ' 半音)'));
      host.appendChild(ipRange('フェードイン (拍)', r.fadeIn || 0, 0, Math.max(4, r.length), 0.05,
        v => { r.fadeIn = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
      host.appendChild(ipRange('フェードアウト (拍)', r.fadeOut || 0, 0, Math.max(4, r.length), 0.05,
        v => { r.fadeOut = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
      host.appendChild(ipCheck('ミュート', r.mute, v => { r.mute = v; Arrange.renderRegions(); }));
      host.appendChild(ipButton('波形エディタで開く', () => WaveEditor.open(r.id)));
      host.appendChild(ipButton('小節に合わせる (タイムストレッチ)', () => App.fitToBarsDialog()));
      host.appendChild(ipButton('ステム分割', () => App.stemsDialog()));
      return;
    }

    host.appendChild(ipRange('開始 (拍)', r.start, 0, Math.max(64, r.start + 64), 0.25,
      v => { r.start = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
    host.appendChild(ipRange('長さ (拍)', r.length, 0.25, Math.max(64, r.length + 32), 0.25,
      v => { r.length = v; Arrange.renderRegions(); }, v => U.round(v, 2)));
    host.appendChild(ipRange('ループ回数', r.loop || 0, 0, 32, 1,
      v => { r.loop = v; Arrange.renderRegions(); }, v => '×' + (v + 1)));
    host.appendChild(ipRange('移調', r.transpose || 0, -24, 24, 1,
      v => { r.transpose = v; Arrange.renderRegions(); }, v => (v > 0 ? '+' : '') + v));
    host.appendChild(ipRange('ベロシティ', r.velocityScale || 1, 0.2, 1.8, 0.01,
      v => { r.velocityScale = v; }, v => Math.round(v * 100) + '%'));
    host.appendChild(ipCheck('ミュート', r.mute, v => { r.mute = v; Arrange.renderRegions(); }));
    host.appendChild(ipButton('ピアノロールで開く', () => PianoRoll.open(r.id)));
  },

  renderTrack() {
    const host = U.$('#insp-track-body');
    host.innerHTML = '';
    const t = Project.track(App.selectedTrackId);
    if (!t) { host.appendChild(U.el('div', 'ip-empty', 'トラック未選択')); return; }

    host.appendChild(ipText('名前', t.name, v => { t.name = v; App.refreshAll(); }));

    if (t.type === 'audio') {
      const lab = U.el('div', 'ip-row');
      lab.style.cssText = 'display:block;font-size:10px;color:var(--accent-2);';
      lab.textContent = '♪ オーディオトラック';
      host.appendChild(lab);
    } else {
    host.appendChild(ipSelect('音源', t.instrument.preset || '',
      Object.keys(Instruments.PRESETS).map(k => ({ value: k, label: k })),
      v => {
        t.instrument = Instruments.fromPreset(v);
        Engine.rebuildInstrument(t.id, t.instrument);
        App.refreshAll();
        if (SpectraUI.isOpen()) {
          if (t.instrument.engine === 'spectra') SpectraUI.open(t); else SpectraUI.close();
        }
      }));
    if (t.instrument.engine === 'spectra')
      host.appendChild(ipButton('SPECTRA エディタを開く', () => SpectraUI.open(t)));
    }
    host.appendChild(ipRange('ボリューム', U.gainToFader(t.volume), 0, 1, 0.001,
      v => { t.volume = U.faderToGain(v); App.applyMix(); Arrange.renderHeaders(); Mixer.syncStrip(t.id); },
      v => U.dbText(U.faderToGain(v)) + ' dB'));
    host.appendChild(ipRange('パン', t.pan, -1, 1, 0.01,
      v => { t.pan = v; App.applyMix(); Mixer.syncStrip(t.id); },
      v => v === 0 ? 'C' : (v < 0 ? 'L' + Math.round(-v * 100) : 'R' + Math.round(v * 100))));
    host.appendChild(ipRange('リバーブ', t.sends.reverb, 0, 1, 0.01,
      v => { t.sends.reverb = v; App.applyMix(); }, v => Math.round(v * 100) + '%'));
    host.appendChild(ipRange('ディレイ', t.sends.delay, 0, 1, 0.01,
      v => { t.sends.delay = v; App.applyMix(); }, v => Math.round(v * 100) + '%'));

    /* EQ */
    const eqh = U.el('div', 'insp-head', 'チャンネル EQ');
    eqh.style.margin = '8px -9px 4px'; host.appendChild(eqh);
    host.appendChild(ipRange('ハイパス', t.eq.hp || 20, 20, 800, 1, v => { t.eq.hp = v; App.applyMix(); }, v => Math.round(v) + ' Hz'));
    host.appendChild(ipRange('Low', t.eq.low, -18, 18, 0.5, v => { t.eq.low = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
    host.appendChild(ipRange('Mid', t.eq.mid, -18, 18, 0.5, v => { t.eq.mid = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
    host.appendChild(ipRange('Mid 周波数', t.eq.midFreq || 1200, 200, 8000, 10, v => { t.eq.midFreq = v; App.applyMix(); }, v => Math.round(v) + ' Hz'));
    host.appendChild(ipRange('High', t.eq.high, -18, 18, 0.5, v => { t.eq.high = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
  },

  /* ── 音源パラメータ (Logic の「詳細」相当) ── */
  renderChannel() {
    const host = U.$('#insp-channel');
    host.innerHTML = '';
    const t = Project.track(App.selectedTrackId);
    if (!t || t.type === 'audio') return;
    if (t.instrument.engine === 'spectra') {
      const h = U.el('div', 'insp-head', 'SPECTRA — ' + (t.instrument.preset || ''));
      host.appendChild(h);
      const b = U.el('div', 'insp-body');
      b.appendChild(ipButton('SPECTRA エディタを開く', () => SpectraUI.open(t)));
      const note = U.el('div', 'ip-empty');
      note.textContent = '専用画面でウェーブテーブル・モジュレーションを編集します';
      b.appendChild(note);
      host.appendChild(b);
      return;
    }
    const head = U.el('div', 'insp-head', '音源パラメータ — ' + (t.instrument.preset || t.instrument.engine));
    host.appendChild(head);
    const body = U.el('div', 'insp-body');
    host.appendChild(body);

    const P = t.instrument.params;
    let timer = null;
    const apply = () => {
      clearTimeout(timer);
      timer = setTimeout(() => Engine.rebuildInstrument(t.id, t.instrument), 90);
    };
    const R = (label, obj, key, min, max, step, fmt) =>
      body.appendChild(ipRange(label, obj[key], min, max, step, v => { obj[key] = v; apply(); }, fmt));
    const S = (label, obj, key, opts) =>
      body.appendChild(ipSelect(label, obj[key], opts, v => { obj[key] = v; apply(); }));

    const waves = ['sawtooth', 'square', 'triangle', 'sine'];

    if (t.instrument.engine === 'drums') {
      R('チューン', P, 'tune', -12, 12, 0.5, v => U.round(v, 1) + ' st');
      R('スナップ', P, 'snap', 0, 1, 0.01, v => Math.round(v * 100) + '%');
      R('ディケイ', P, 'decay', 0.3, 2.2, 0.01, v => U.round(v, 2) + '×');
      R('レベル', P, 'level', 0, 1.4, 0.01, v => U.round(v, 2));
      body.appendChild(ipButton('ドラムマップを表示', () => App.showDrumMap()));
      return;
    }
    if (t.instrument.engine === 'fm') {
      R('比率 (Ratio)', P, 'ratio', 0.25, 12, 0.01, v => U.round(v, 2));
      R('変調量 (Index)', P, 'index', 0, 10, 0.05, v => U.round(v, 2));
      R('変調ディケイ', P, 'indexDecay', 0.02, 2.5, 0.01, v => U.round(v, 2) + ' s');
      R('アタック', P.aenv, 'a', 0.001, 2, 0.001, v => U.round(v * 1000, 0) + ' ms');
      R('ディケイ', P.aenv, 'd', 0.01, 6, 0.01, v => U.round(v, 2) + ' s');
      R('サステイン', P.aenv, 's', 0, 1, 0.01, v => Math.round(v * 100) + '%');
      R('リリース', P.aenv, 'r', 0.01, 4, 0.01, v => U.round(v, 2) + ' s');
      R('トーン', P, 'tone', 800, 16000, 50, v => Math.round(v) + ' Hz');
      R('ステレオ幅', P, 'stereo', 0, 1, 0.01, v => Math.round(v * 100) + '%');
      R('レベル', P, 'level', 0, 1.2, 0.01, v => U.round(v, 2));
      return;
    }

    /* subtractive synth */
    body.appendChild(U.el('div', 'st-sec-cap', 'OSC 1'));
    S('波形', P.osc1, 'wave', waves);
    R('オクターブ', P.osc1, 'oct', -3, 3, 1, v => (v > 0 ? '+' : '') + v);
    R('レベル', P.osc1, 'level', 0, 1, 0.01, v => U.round(v, 2));
    body.appendChild(U.el('div', 'st-sec-cap', 'OSC 2'));
    S('波形', P.osc2, 'wave', waves);
    R('オクターブ', P.osc2, 'oct', -3, 3, 1, v => (v > 0 ? '+' : '') + v);
    R('デチューン', P.osc2, 'detune', -50, 50, 1, v => v + ' ct');
    R('レベル', P.osc2, 'level', 0, 1, 0.01, v => U.round(v, 2));
    R('ノイズ', P, 'noise', 0, 1, 0.01, v => U.round(v, 2));
    R('ユニゾン', P, 'unison', 1, 5, 1, v => v + ' 声');
    R('スプレッド', P, 'spread', 0, 40, 1, v => v + ' ct');

    body.appendChild(U.el('div', 'st-sec-cap', 'FILTER'));
    S('タイプ', P.filter, 'type', ['lowpass', 'highpass', 'bandpass', 'notch']);
    R('カットオフ', P.filter, 'cutoff', 40, 12000, 10, v => Math.round(v) + ' Hz');
    R('レゾナンス', P.filter, 'q', 0.1, 22, 0.1, v => U.round(v, 1));
    R('エンベロープ', P.filter, 'env', -6000, 8000, 50, v => Math.round(v) + ' Hz');
    R('キートラック', P.filter, 'keytrack', 0, 1, 0.01, v => Math.round(v * 100) + '%');
    R('F.アタック', P.fenv, 'a', 0.001, 2, 0.001, v => Math.round(v * 1000) + ' ms');
    R('F.ディケイ', P.fenv, 'd', 0.01, 4, 0.01, v => U.round(v, 2) + ' s');
    R('F.サステイン', P.fenv, 's', 0, 1, 0.01, v => Math.round(v * 100) + '%');

    body.appendChild(U.el('div', 'st-sec-cap', 'AMP ENV'));
    R('アタック', P.aenv, 'a', 0.001, 3, 0.001, v => Math.round(v * 1000) + ' ms');
    R('ディケイ', P.aenv, 'd', 0.01, 4, 0.01, v => U.round(v, 2) + ' s');
    R('サステイン', P.aenv, 's', 0, 1, 0.01, v => Math.round(v * 100) + '%');
    R('リリース', P.aenv, 'r', 0.01, 5, 0.01, v => U.round(v, 2) + ' s');

    body.appendChild(U.el('div', 'st-sec-cap', 'LFO / DRIVE'));
    R('LFO レート', P.lfo, 'rate', 0.05, 18, 0.01, v => U.round(v, 2) + ' Hz');
    R('→ ピッチ', P.lfo, 'pitch', 0, 60, 1, v => v + ' ct');
    R('→ フィルタ', P.lfo, 'filter', 0, 4000, 10, v => Math.round(v) + ' Hz');
    R('ドライブ', P, 'drive', 0, 1, 0.01, v => Math.round(v * 100) + '%');
    R('レベル', P, 'level', 0, 1.2, 0.01, v => U.round(v, 2));
  }
};

window.Inspector = Inspector;
window.ipRange = ipRange; window.ipSelect = ipSelect;
window.ipText = ipText; window.ipCheck = ipCheck; window.ipButton = ipButton;
