/* ══════════════════════════════════════════════════════════════
   app.js — アプリケーション統合 / ショートカット / ダイアログ
   ══════════════════════════════════════════════════════════════ */
'use strict';

const App = {
  selectedTrackId: null,
  selectedRegionId: null,
  clipboard: null,
  typing: false,
  octave: 4,
  _held: new Map(),
  _recBuf: [],
  _cpu: 0,

  /* ══════════════ 起動 ══════════════ */
  init() {
    Engine.loadPrefs();
    Project.load(buildDemoSong());
    this.selectedTrackId = Project.data.tracks[0].id;
    Arrange.selTracks.add(this.selectedTrackId);

    Menus.init();
    Arrange.init();
    PianoRoll.init();
    StepSeq.init();
    this.bindTransport();
    this.bindLCD();
    this.bindPanes();
    this.bindKeyboard();
    this.buildLibrary();
    this.bindDragDrop();
    WaveEditor.init();

    U.$('#splash-start').onclick = () => this.start();
    /* Enter でも起動 */
    window.addEventListener('keydown', function once(e) {
      if (!U.$('#splash').classList.contains('hidden') && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault(); App.start(); window.removeEventListener('keydown', once);
      }
    });
  },

  async start() {
    U.$('#splash').classList.add('hidden');
    Engine.init();
    /* 波形テーブル等を先に生成しておき、初回発音の遅延をなくす */
    Instruments.prewarm(Engine.ctx);
    Engine.rebuild(Project.data);
    const ok = await Engine.resume();
    /* 何らかの理由で suspended のままなら、次のユーザー操作で自動復帰させる */
    if (!ok) {
      const wake = () => {
        Engine.ctx.resume().then(() => {
          U.$('#engine-state').textContent = '● ENGINE ON  ' + Math.round(Engine.ctx.sampleRate / 1000) + 'k';
          U.$('#engine-state').classList.add('on');
          this.updateLatencyUI();
        }).catch(() => {});
        window.removeEventListener('pointerdown', wake, true);
        window.removeEventListener('keydown', wake, true);
      };
      window.addEventListener('pointerdown', wake, true);
      window.addEventListener('keydown', wake, true);
    }
    Engine.setMasterVolume(Project.data.masterVolume);
    U.$('#master-volume').value = Math.min(1.2, Project.data.masterVolume);
    U.$('#engine-state').textContent = ok ? '● ENGINE ON  ' + Math.round(Engine.ctx.sampleRate / 1000) + 'k' : '● ENGINE OFF';
    U.$('#engine-state').classList.toggle('on', ok);

    Arrange.layout();
    this.refreshAll();
    Arrange.selectTrack(Project.data.tracks[0].id, false);
    this.loop();
    this.updateLatencyUI();

    /* MIDI キーボードを接続 */
    Midi.init().then(ok => {
      this.updateMidiUI();
      if (ok && Midi.inputs.length) {
        U.toast('MIDI 入力を検出: ' + Midi.inputs.map(i => i.name).join(', '));
      }
    });
    U.$('#midi-ind').onclick = () => this.midiDialog();
    U.$('#latency-ind').onclick = () => this.showLatency();

    U.toast('Browser DAW へようこそ — Space キーで再生');
  },

  onMidiDevices() { this.updateMidiUI(); },
  updateMidiUI() {
    const el = U.$('#midi-ind');
    const n = Midi.inputs.filter(i => i.enabled).length;
    el.classList.toggle('on', n > 0);
    el.querySelector('.midi-txt').textContent = Midi.supported
      ? (n ? 'MIDI ' + n : 'MIDI') : 'MIDI ✕';
  },
  onMidiActivity(pitch, vel, on) {
    const el = U.$('#midi-ind');
    if (on) { el.classList.add('act'); clearTimeout(this._midiT);
              this._midiT = setTimeout(() => el.classList.remove('act'), 130); }
  },
  updateLatencyUI() {
    const el = U.$('#latency-ind');
    const l = Latency.output();
    if (!l) { el.textContent = '— ms'; return; }
    el.textContent = l.total.toFixed(1) + ' ms';
    el.classList.toggle('good', l.total < 15);
    el.classList.toggle('warn', l.total >= 30);
  },

  /* ══════════════ 描画ループ ══════════════ */
  /* 描画ループ — メインスレッドを空けておくことが低レイテンシの条件。
     再生中でない時は更新頻度を大きく落とす。 */
  loop() {
    const t0 = performance.now();
    const playing = Transport.isPlaying();
    this._frame = (this._frame || 0) + 1;

    if (Engine.graph) {
      if (playing) {
        Loudness.update();
        Arrange.updatePlayhead();
        PianoRoll.updatePlayhead();
        if (this._frame % 2 === 0) Arrange.drawRuler();
        if (this._frame % 2 === 0) Mixer.updateMeters();
        if (this._frame % 4 === 0) StepSeq.highlight();
        if (this._frame % 3 === 0) this.updateLCD();
        Arrange.followPlayhead();
        if (WaveEditor._preview) WaveEditor.draw();
      } else if (this._frame % 4 === 0) {
        Mixer.updateMeters();
        this.updateLCD();
        if (MasteringUI.isOpen()) Loudness.update();
      }
    }
    const dt = performance.now() - t0;
    this._cpu = this._cpu * 0.92 + (dt / 16) * 0.08;
    if (this._frame % 8 === 0) { this.drawCpu(); this.updateLatencyUI(); }
    requestAnimationFrame(() => this.loop());
  },

  drawCpu() {
    const bars = U.$$('#cpu-meter .cpu-bars i');
    const n = U.clamp(Math.round(this._cpu * 8), 0, 8);
    bars.forEach((b, i) => {
      b.className = i < n ? ('on' + (i >= 6 ? ' max' : i >= 4 ? ' hi' : '')) : '';
    });
  },

  /* ══════════════ LCD ══════════════ */
  updateLCD() {
    const p = Project.data;
    const b = Transport.isPlaying() ? Transport.now() : Transport.positionBeats;
    U.$('#lcd-bbt').textContent = U.bbt(b, p.sigNum);
    U.$('#lcd-smpte').textContent = U.smpte(b * 60 / p.tempo);
    U.$('#lcd-bpm').textContent = p.tempo.toFixed(2);
    U.$('#lcd-timesig').textContent = p.sigNum + ' / ' + p.sigDen;
    const d = Arrange.snap;
    U.$('#lcd-division').textContent = d ? ('1 / ' + Math.round(4 / d)) : 'オフ';
  },

  bindLCD() {
    const p = () => Project.data;
    U.$('#lcd-tempo').onmousedown = e => {
      const t0 = p().tempo;
      U.dragValue(e, t0, 20, 300, 220, v => {
        p().tempo = Math.round(v * 100) / 100;
        this.updateLCD(); Engine.applyBusParams(p());
      }, () => Project.snapshot('テンポ変更'));
    };
    U.$('#lcd-tempo').ondblclick = () => {
      Modal.show('テンポを設定', body => {
        const row = ipRange('テンポ (BPM)', p().tempo, 20, 300, 0.01,
          v => { p().tempo = v; this.updateLCD(); Engine.applyBusParams(p()); }, v => v.toFixed(2));
        body.appendChild(row);
      });
    };
    U.$('#lcd-sig').onmousedown = e => {
      const n0 = p().sigNum;
      U.dragValue(e, n0, 1, 16, 300, v => { p().sigNum = Math.round(v); this.updateLCD(); Arrange.render(); },
        () => Project.snapshot('拍子変更'));
    };
    U.$('#lcd-div').onmousedown = e => {
      const opts = [0, 4, 2, 1, 0.5, 0.25, 0.125];
      const i0 = Math.max(0, opts.indexOf(Arrange.snap));
      U.dragValue(e, i0, 0, opts.length - 1, 200, v => {
        const i = Math.round(v);
        Arrange.snap = opts[i];
        U.$('#snap-select').value = String(opts[i]);
        this.updateLCD(); Arrange.drawGrid();
      });
    };
    U.$('#lcd-position').onmousedown = e => {
      const b0 = Transport.positionBeats;
      U.dragValue(e, b0, 0, Project.lengthBeats(), 300, v => {
        Transport.positionBeats = Arrange.snapBeat(v); this.onPositionChange();
      });
    };
  },

  /* ══════════════ トランスポート ══════════════ */
  bindTransport() {
    U.$('#tp-play').onclick  = () => Transport.isPlaying() ? Transport.stop() : Transport.play(false);
    U.$('#tp-stop').onclick  = () => Transport.stopOrReturn();
    U.$('#tp-rec').onclick   = () => this.toggleRecord();
    U.$('#tp-begin').onclick = () => Transport.locate(0);
    U.$('#tp-rew').onclick   = () => Transport.nudgeBars(-1);
    U.$('#tp-ff').onclick    = () => Transport.nudgeBars(1);
    U.$('#tp-cycle').onclick = () => this.toggleCycle();
    U.$('#btn-metronome').onclick = () => {
      Project.data.metronome = !Project.data.metronome;
      U.$('#btn-metronome').classList.toggle('active', Project.data.metronome);
    };
    U.$('#btn-count-in').onclick = () => {
      Project.data.countIn = !Project.data.countIn;
      U.$('#btn-count-in').classList.toggle('active', Project.data.countIn);
    };
    U.$('#btn-typing').onclick = () => this.toggleTyping();
    U.$('#master-volume').oninput = e => {
      Project.data.masterVolume = +e.target.value;
      Engine.setMasterVolume(Project.data.masterVolume);
      if (Mixer.masterFader) {
        Mixer.masterFader.value = U.gainToFader(Project.data.masterVolume);
        Mixer.masterDb.textContent = U.dbText(Project.data.masterVolume);
      }
    };
  },

  onTransportChange() {
    U.$('#tp-play').classList.toggle('active', Transport.isPlaying());
    U.$('#tp-rec').classList.toggle('active', Transport.state === 'recording');
  },
  onPositionChange() { Arrange.updatePlayhead(); Arrange.drawRuler(); PianoRoll.updatePlayhead(); this.updateLCD(); },

  toggleCycle() {
    const p = Project.data;
    p.cycle.on = !p.cycle.on;
    U.$('#tp-cycle').classList.toggle('active', p.cycle.on);
    Arrange.updateCycleZone(); Arrange.drawRuler();
  },
  cycleToSelection() {
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) { U.toast('リージョンを選択してください'); return; }
    let s = 1e9, e = -1e9;
    ids.forEach(id => {
      const f = Project.region(id); if (!f) return;
      s = Math.min(s, f.region.start);
      e = Math.max(e, Project.regionEnd(f.region));
    });
    Project.snapshot('サイクル設定');
    Project.data.cycle = { on: true, start: s, end: e };
    U.$('#tp-cycle').classList.add('active');
    Arrange.updateCycleZone(); Arrange.drawRuler();
  },

  toggleRecord() {
    if (Transport.state === 'recording') { Transport.stop(); return; }
    const armed = Project.data.tracks.find(t => t.armed) || Project.track(this.selectedTrackId);
    if (!armed) { U.toast('録音するトラックがありません'); return; }
    armed.armed = true;
    Project.data.tracks.forEach(t => { if (t !== armed) t.armed = false; });
    Arrange.renderHeaders();
    this._recBuf = [];
    this._recTrack = armed;
    this._recStart = Transport.positionBeats;
    if (!this.typing) { this.toggleTyping(true); }
    Transport.play(true);
    U.toast('録音中 — PCキーボード (A・S・D…) で演奏できます');
  },

  finalizeRecording() {
    const t = this._recTrack;
    if (!t || !this._recBuf.length) { this._recBuf = []; return; }
    Project.snapshot('録音');
    const notes = this._recBuf.filter(n => n.length > 0.01);
    let s = 1e9, e = -1e9;
    notes.forEach(n => { s = Math.min(s, n.start); e = Math.max(e, n.start + n.length); });
    const sig = Project.data.sigNum;
    const start = Math.floor(s / sig) * sig;
    const end = Math.ceil(e / sig) * sig;
    const r = newRegion(t.id, start, Math.max(sig, end - start), '録音 ' + (t.regions.length + 1));
    notes.forEach(n => r.notes.push(newNote(n.pitch, n.start - start, n.length, n.vel)));
    t.regions.push(r);
    Arrange.selRegions.clear(); Arrange.selRegions.add(r.id);
    this._recBuf = [];
    this.refreshAll();
    U.toast(r.notes.length + ' ノートを録音しました');
  },

  /* ══════════════ パネル ══════════════ */
  bindPanes() {
    U.$('#btn-inspector').onclick = () => this.togglePane('inspector');
    U.$('#btn-library').onclick   = () => this.togglePane('library');
    U.$('#btn-quickhelp').onclick = () => this.showGuide();
    U.$('#btn-mixer').onclick  = () => this.toggleEditor('mixer');
    U.$('#btn-editor').onclick = () => this.toggleEditor('pianoroll');
    U.$('#editor-close').onclick = () => this.hideEditor();
    U.$$('.etab').forEach(t => t.onclick = () => this.showEditor(t.dataset.view));

    /* エディタ高さ調整 */
    const sp = U.$('#editor-splitter');
    sp.onmousedown = e => {
      const h0 = U.$('#editor-pane').offsetHeight;
      U.drag(e, (dx, dy) => {
        const h = U.clamp(h0 - dy, 120, window.innerHeight - 220);
        U.$('#editor-pane').style.flex = '0 0 ' + h + 'px';
        U.$('#editor-pane').style.height = h + 'px';
      }, () => { Arrange.layout(); PianoRoll.render(); }, 'ns-resize');
    };
  },

  togglePane(which) {
    const el = U.$('#' + which);
    el.classList.toggle('hidden');
    U.$('#btn-' + which).classList.toggle('active', !el.classList.contains('hidden'));
    setTimeout(() => Arrange.layout(), 30);
  },

  showEditor(view) {
    const pane = U.$('#editor-pane');
    pane.classList.remove('hidden');
    /* ミキサーはストリップ全体が入る高さを確保する */
    const need = view === 'mixer' ? 406 : 260;
    if (pane.offsetHeight < need) {
      const h = Math.min(need, window.innerHeight - 200);
      pane.style.flex = '0 0 ' + h + 'px';
      pane.style.height = h + 'px';
    }
    U.$('#editor-splitter').classList.remove('hidden');
    U.$$('.etab').forEach(t => t.classList.toggle('active', t.dataset.view === view));
    U.$$('.eview').forEach(v => v.classList.toggle('hidden', v.id !== 'view-' + view));
    U.$('#btn-mixer').classList.toggle('active', view === 'mixer');
    U.$('#btn-editor').classList.toggle('active', view === 'pianoroll');
    setTimeout(() => {
      Arrange.layout();
      if (view === 'pianoroll') PianoRoll.render();
      if (view === 'mixer') Mixer.render();
      if (view === 'stepseq') StepSeq.render();
      if (view === 'wave') WaveEditor.draw();
    }, 20);
  },
  hideEditor() {
    U.$('#editor-pane').classList.add('hidden');
    U.$('#editor-splitter').classList.add('hidden');
    U.$('#btn-mixer').classList.remove('active');
    U.$('#btn-editor').classList.remove('active');
    setTimeout(() => Arrange.layout(), 20);
  },
  toggleEditor(view) {
    const pane = U.$('#editor-pane');
    const active = !pane.classList.contains('hidden') &&
                   !U.$('#view-' + view).classList.contains('hidden');
    if (active) this.hideEditor(); else this.showEditor(view);
  },

  /* ══════════════ ライブラリ ══════════════ */
  buildLibrary() {
    const host = U.$('#lib-list');
    host.innerHTML = '';
    const order = ['SPECTRA (ウェーブテーブル)', 'ビンテージ実機 (70s〜90s)',
                   '物理モデル (生楽器)', 'アナログシンセ', 'FM 音源', 'ドラム'];
    const groups = {};
    order.forEach(g => groups[g] = []);
    Object.keys(Instruments.PRESETS).forEach(k => {
      const g = Instruments.category(k);
      (groups[g] = groups[g] || []).push(k);
    });
    Object.keys(groups).forEach(g => {
      if (!groups[g].length) return;
      host.appendChild(U.el('div', 'lib-cat', g));
      groups[g].forEach(name => {
        const it = U.el('div', 'lib-item', name);
        it.onclick = () => {
          const t = Project.track(this.selectedTrackId);
          if (!t) { U.toast('トラックを選択してください'); return; }
          Project.snapshot('音源変更');
          t.instrument = Instruments.fromPreset(name);
          Engine.rebuildInstrument(t.id, t.instrument);
          this.refreshAll();
          U.$$('#lib-list .lib-item').forEach(x => x.classList.remove('active'));
          it.classList.add('active');
          if (SpectraUI.isOpen() && t.instrument.engine === 'spectra') SpectraUI.open(t);
          U.toast(name + ' を読み込みました');
        };
        host.appendChild(it);
      });
    });
  },

  /* ══════════════ 更新 ══════════════ */
  applyMix() { Engine.applyMixParams(Project.data); },
  rebuildAudio() {
    const wasPlaying = Transport.isPlaying();
    if (wasPlaying) Transport.stop();
    Engine.rebuild(Project.data);
    Engine.setMasterVolume(Project.data.masterVolume);
    this.refreshAll();
    if (wasPlaying) Transport.play(false);
  },
  refreshAll() {
    Arrange.render();
    Mixer.render();
    Inspector.render();
    StepSeq.render();
    PianoRoll.render();
    this.applyMix();
    this.updateLCD();
  },
  refreshArrangeOnly() { Arrange.renderRegions(); Inspector.renderRegion(); },

  /* ══════════════ 編集コマンド ══════════════ */
  undo() { if (Project.undo()) { this.validateSelection(); this.rebuildAudio(); } },
  redo() { if (Project.redo()) { this.validateSelection(); this.rebuildAudio(); } },

  /* 取り消し等でデータが入れ替わった後、選択状態が実在するか検査する */
  validateSelection() {
    const ts = Project.data.tracks;
    if (!ts.length) { this.selectedTrackId = null; Arrange.selTracks.clear(); Arrange.selRegions.clear(); return; }
    if (!Project.track(this.selectedTrackId)) this.selectedTrackId = ts[0].id;
    Arrange.selTracks.forEach(id => { if (!Project.track(id)) Arrange.selTracks.delete(id); });
    if (!Arrange.selTracks.size) Arrange.selTracks.add(this.selectedTrackId);
    Arrange.selRegions.forEach(id => { if (!Project.region(id)) Arrange.selRegions.delete(id); });
    if (PianoRoll.regionId && !Project.region(PianoRoll.regionId)) {
      PianoRoll.regionId = null; PianoRoll.sel.clear();
    }
  },

  inPianoRoll() {
    return !U.$('#editor-pane').classList.contains('hidden') &&
           !U.$('#view-pianoroll').classList.contains('hidden') && PianoRoll.sel.size > 0;
  },

  copy() {
    if (this.inPianoRoll()) {
      const r = PianoRoll.region();
      this.clipboard = { kind: 'notes', data: r.notes.filter(n => PianoRoll.sel.has(n.id)).map(n => Object.assign({}, n)) };
      U.toast(this.clipboard.data.length + ' ノートをコピー');
      return;
    }
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) return;
    this.clipboard = { kind: 'regions', data: ids.map(id => JSON.parse(JSON.stringify(Project.region(id).region))) };
    U.toast(ids.length + ' リージョンをコピー');
  },
  cut() { this.copy(); this.deleteSelection(); },
  paste(track, beat) {
    if (!this.clipboard) return;
    if (this.clipboard.kind === 'notes') {
      const r = PianoRoll.region(); if (!r) return;
      Project.snapshot('ペースト');
      const at = Transport.positionBeats - r.start;
      let min = 1e9; this.clipboard.data.forEach(n => min = Math.min(min, n.start));
      PianoRoll.sel.clear();
      this.clipboard.data.forEach(n => {
        const c = Object.assign({}, n, { id: U.uid('n'), start: Math.max(0, at + (n.start - min)) });
        r.notes.push(c); PianoRoll.sel.add(c.id);
      });
      PianoRoll.render(); this.refreshArrangeOnly();
      return;
    }
    const t = track || Project.track(this.selectedTrackId);
    if (!t) return;
    Project.snapshot('ペースト');
    const at = beat != null ? beat : Transport.positionBeats;
    let min = 1e9; this.clipboard.data.forEach(r => min = Math.min(min, r.start));
    Arrange.selRegions.clear();
    this.clipboard.data.forEach(r => {
      const c = JSON.parse(JSON.stringify(r));
      c.id = U.uid('rgn'); c.notes.forEach(n => n.id = U.uid('n'));
      c.start = Math.max(0, at + (r.start - min));
      t.regions.push(c); Arrange.selRegions.add(c.id);
    });
    this.refreshAll();
  },
  deleteSelection() {
    if (this.inPianoRoll()) { PianoRoll.deleteSelected(); return; }
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) return;
    Project.snapshot('リージョン削除');
    ids.forEach(id => {
      const f = Project.region(id);
      if (f) f.track.regions.splice(f.track.regions.indexOf(f.region), 1);
    });
    Arrange.selRegions.clear();
    this.refreshAll();
  },
  selectAll() {
    if (!U.$('#view-pianoroll').classList.contains('hidden') && PianoRoll.regionId) { PianoRoll.selectAll(); return; }
    Arrange.selRegions.clear();
    Project.allRegions().forEach(({ region }) => Arrange.selRegions.add(region.id));
    Arrange.renderRegions(); Inspector.render();
  },
  duplicateRegions() {
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) return;
    Project.snapshot('リージョン複製');
    const news = [];
    ids.forEach(id => {
      const f = Project.region(id); if (!f) return;
      const c = JSON.parse(JSON.stringify(f.region));
      c.id = U.uid('rgn'); c.notes.forEach(n => n.id = U.uid('n'));
      c.start = Project.regionEnd(f.region);
      f.track.regions.push(c); news.push(c.id);
    });
    Arrange.selRegions.clear(); news.forEach(id => Arrange.selRegions.add(id));
    this.refreshAll();
  },
  regionOp(fn) {
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) { U.toast('リージョンを選択してください'); return; }
    Project.snapshot('リージョン編集');
    ids.forEach(id => { const f = Project.region(id); if (f) fn(f.region); });
    this.refreshAll();
  },
  splitAtPlayhead() {
    const at = Transport.isPlaying() ? Transport.now() : Transport.positionBeats;
    const ids = Array.from(Arrange.selRegions);
    const list = ids.length ? ids : Project.allRegions().map(x => x.region.id);
    list.forEach(id => {
      const f = Project.region(id); if (!f) return;
      if (at > f.region.start && at < Project.regionEnd(f.region)) Arrange.splitRegion(f.track, f.region, at);
    });
  },
  glueSelection() {
    const ids = Array.from(Arrange.selRegions);
    if (!ids.length) return;
    const f = Project.region(ids[0]); if (!f) return;
    Arrange.glueSelected(f.track);
  },
  openSelectedRegion() {
    const id = Array.from(Arrange.selRegions)[0] || this.selectedRegionId;
    if (!id) { U.toast('リージョンを選択してください'); return; }
    this.openRegion(id);
  },
  openRegion(id) {
    const f = Project.region(id);
    if (!f) return;
    if (f.region.type === 'audio') WaveEditor.open(id);
    else PianoRoll.open(id);
  },
  openSpectra() {
    const t = Project.track(this.selectedTrackId);
    if (!t) { U.toast('トラックを選択してください'); return; }
    if (t.type === 'audio') { U.toast('オーディオトラックには音源がありません'); return; }
    if (t.instrument.engine !== 'spectra') {
      Project.snapshot('SPECTRA に切り替え');
      t.instrument = Instruments.fromPreset('Neon Supersaw');
      Engine.rebuildInstrument(t.id, t.instrument);
      this.refreshAll();
    }
    SpectraUI.open(t);
  },
  clearAll(which) {
    Project.snapshot(which === 'mute' ? 'ミュート解除' : 'ソロ解除');
    Project.data.tracks.forEach(t => t[which] = false);
    this.applyMix(); Arrange.renderHeaders(); Mixer.render();
  },
  zoomToFit() {
    const w = U.$('#grid-wrap').clientWidth;
    let end = 16;
    Project.allRegions().forEach(({ region }) => end = Math.max(end, Project.regionEnd(region)));
    Arrange.setZoom(Math.max(6, (w - 30) / end));
    U.$('#grid-wrap').scrollLeft = 0;
  },
  toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
    else document.exitFullscreen && document.exitFullscreen();
  },

  /* ══════════════ トラック操作 ══════════════ */
  addTrack(presetName) {
    Project.snapshot('トラック追加');
    const t = Project.addTrack({
      name: presetName, instrument: Instruments.fromPreset(presetName),
      color: U.COLORS[Project.data.tracks.length % U.COLORS.length]
    });
    Engine.rebuild(Project.data);
    Engine.setMasterVolume(Project.data.masterVolume);
    this.refreshAll();
    Arrange.selectTrack(t.id, false);
    return t;
  },
  addTrackDialog() {
    Modal.show('新規トラック', body => {
      const names = Object.keys(Instruments.PRESETS);
      body.appendChild(ipText('トラック名', '新規トラック', v => body.__name = v));
      body.__name = '新規トラック';
      body.__preset = names[0];
      body.appendChild(ipSelect('音源', names[0], names.map(n => ({ value: n, label: n })), v => body.__preset = v));
      body.appendChild(U.el('p', null, 'ライブラリ (Y) からいつでも音源を差し替えられます。'));
    }, [
      { label: 'キャンセル' },
      { label: '作成', primary: true, fn: body => {
          const t = this.addTrack(body.__preset);
          Project.snapshot('トラック名');
          t.name = body.__name || body.__preset;
          this.refreshAll();
        } }
    ]);
  },
  duplicateTrack() {
    const t = Project.track(this.selectedTrackId);
    if (!t) return;
    Project.snapshot('トラック複製');
    const c = JSON.parse(JSON.stringify(t));
    c.id = U.uid('trk'); c.name = t.name + ' コピー';
    c.regions.forEach(r => { r.id = U.uid('rgn'); r.notes.forEach(n => n.id = U.uid('n')); });
    Project.data.tracks.splice(Project.trackIndex(t.id) + 1, 0, c);
    this.rebuildAudio();
    Arrange.selectTrack(c.id, false);
  },
  deleteSelectedTracks() {
    const ids = Arrange.selTracks.size ? Array.from(Arrange.selTracks) : [this.selectedTrackId];
    if (!ids.length || !ids[0]) return;
    if (Project.data.tracks.length <= ids.length) { U.toast('最後のトラックは削除できません'); return; }
    Project.snapshot('トラック削除');
    ids.forEach(id => Project.removeTrack(id));
    Arrange.selTracks.clear();
    this.selectedTrackId = Project.data.tracks[0].id;
    Arrange.selTracks.add(this.selectedTrackId);
    this.rebuildAudio();
  },
  pickColor(t) {
    Modal.show('トラックカラー', body => {
      const grid = U.el('div');
      grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,1fr);gap:7px;margin:8px 0;';
      U.COLORS.forEach(c => {
        const s = U.el('div');
        s.style.cssText = 'height:34px;border-radius:5px;cursor:pointer;border:2px solid ' +
          (c === t.color ? '#fff' : 'transparent') + ';background:' + c;
        s.onclick = () => { Project.snapshot('カラー変更'); t.color = c; this.refreshAll(); Modal.hide(); };
        grid.appendChild(s);
      });
      body.appendChild(grid);
    }, [{ label: '閉じる', primary: true }]);
  },

  trackContextMenu(e, t) {
    this.contextMenu(e, [
      { label: 'このトラックのみソロ', fn: () => {
          Project.snapshot('ソロ');
          Project.data.tracks.forEach(x => x.solo = (x === t));
          this.applyMix(); Arrange.renderHeaders(); Mixer.render();
        } },
      { label: 'ミュート切り替え', fn: () => { t.mute = !t.mute; this.applyMix(); Arrange.renderHeaders(); Mixer.render(); } },
      { sep: true },
      { label: '音源を変更…', fn: () => this.instrumentPicker(t) },
      { label: 'エフェクトを追加…', fn: () => this.fxPicker(t) },
      { label: 'トラックカラー…', fn: () => this.pickColor(t) },
      { sep: true },
      { label: 'トラックを複製', fn: () => { Arrange.selectTrack(t.id, false); this.duplicateTrack(); } },
      { label: 'トラックを削除', fn: () => { Arrange.selTracks.clear(); Arrange.selTracks.add(t.id); this.deleteSelectedTracks(); } }
    ]);
  },
  regionContextMenu(e, r, t) {
    this.contextMenu(e, [
      { label: 'ピアノロールで開く', fn: () => PianoRoll.open(r.id) },
      { sep: true },
      { label: '複製', fn: () => this.duplicateRegions() },
      { label: 'コピー', fn: () => this.copy() },
      { label: '削除', fn: () => this.deleteSelection() },
      { sep: true },
      { label: 'ループ ×2', fn: () => this.regionOp(x => x.loop = (x.loop || 0) + 1) },
      { label: 'ループ解除', fn: () => this.regionOp(x => x.loop = 0) },
      { label: r.mute ? 'ミュート解除' : 'ミュート', fn: () => this.regionOp(x => x.mute = !x.mute) },
      { sep: true },
      { label: '再生ヘッド位置で分割', fn: () => this.splitAtPlayhead() },
      { label: 'この範囲をループに設定', fn: () => this.cycleToSelection() }
    ]);
  },

  contextMenu(e, items) {
    e.preventDefault();
    const cm = U.$('#ctxmenu');
    cm.innerHTML = '';
    Menus.fill(cm, items);
    cm.classList.remove('hidden');
    const w = cm.offsetWidth, h = cm.offsetHeight;
    cm.style.left = Math.min(e.clientX, window.innerWidth - w - 8) + 'px';
    cm.style.top  = Math.min(e.clientY, window.innerHeight - h - 8) + 'px';
  },

  /* ══════════════ 音源 / FX ダイアログ ══════════════ */
  instrumentPicker(t) {
    Modal.show('音源を選択 — ' + t.name, body => {
      const names = Object.keys(Instruments.PRESETS);
      const list = U.el('div');
      list.style.cssText = 'max-height:340px;overflow:auto;border:1px solid #1a1a1e;border-radius:6px;';
      names.forEach(n => {
        const it = U.el('div', 'lib-item' + (t.instrument.preset === n ? ' active' : ''), n);
        it.onclick = () => {
          Project.snapshot('音源変更');
          t.instrument = Instruments.fromPreset(n);
          Engine.rebuildInstrument(t.id, t.instrument);
          this.refreshAll(); Modal.hide();
        };
        list.appendChild(it);
      });
      body.appendChild(list);
    }, [{ label: '閉じる', primary: true }]);
  },

  fxPicker(t) {
    Modal.show('エフェクトを追加 — ' + t.name, body => {
      const list = U.el('div');
      list.style.cssText = 'max-height:320px;overflow:auto;border:1px solid #1a1a1e;border-radius:6px;';
      Object.keys(FX.DEFS).forEach(k => {
        const it = U.el('div', 'lib-item', FX.DEFS[k].label);
        it.onclick = () => {
          Project.snapshot('エフェクト追加');
          t.inserts = t.inserts || [];
          t.inserts.push(FX.defaultData(k));
          this.rebuildAudio(); Modal.hide();
          U.toast(FX.DEFS[k].label + ' を追加しました');
        };
        list.appendChild(it);
      });
      body.appendChild(list);
    }, [{ label: '閉じる', primary: true }]);
  },

  fxEditor(t, index) {
    const data = t.inserts[index];
    const def = FX.DEFS[data.type];
    Modal.show(def.label + ' — ' + t.name, body => {
      body.appendChild(ipCheck('有効', data.on !== false, v => { data.on = v; this.rebuildAudio(); }));
      const choices = (FX.CHOICES || {})[data.type] || {};
      Object.keys(choices).forEach(k => {
        body.appendChild(ipSelect(k, String(data.params[k]),
          choices[k].map(c => ({ value: String(c.v), label: c.l })),
          v => { data.params[k] = (isNaN(+v) ? v : +v); this.rebuildAudio(); }));
      });
      Object.keys(def.ranges || {}).forEach(k => {
        const [min, max, step, unit] = def.ranges[k];
        body.appendChild(ipRange(k, data.params[k], min, max, step, v => {
          data.params[k] = v;
          const ch = Engine.channel(t.id);
          const fx = ch && ch.inserts[index];
          if (fx && fx.setParam) fx.setParam(k, v);
        }, v => U.round(v, 3) + (unit || '')));
      });
      if (def.params.type && !choices.type) {
        body.appendChild(ipSelect('フィルタタイプ', data.params.type, ['lowpass', 'highpass', 'bandpass', 'notch'],
          v => { data.params.type = v; this.rebuildAudio(); }));
      }
      body.appendChild(ipButton('このエフェクトを削除', () => {
        Project.snapshot('エフェクト削除');
        t.inserts.splice(index, 1);
        this.rebuildAudio(); Modal.hide();
      }));
    }, [{ label: '閉じる', primary: true }]);
  },

  /* ══════════════ ファイル ══════════════ */
  newProject() {
    if (!confirm('新規プロジェクトを作成します。現在の内容は失われます。よろしいですか?')) return;
    Transport.stop();
    AudioPool.clear();
    WaveEditor.assetId = null; WaveEditor.regionId = null;
    const p = Project.blank();
    Project.load(p);
    Project.addTrack({ name: 'Piano', instrument: Instruments.fromPreset('Grand Piano') });
    Project.addTrack({ name: 'Drum Kit', instrument: Instruments.fromPreset('Acoustic Kit'), color: U.COLORS[4] });
    this.selectedTrackId = p.tracks[0].id;
    Arrange.selTracks.clear(); Arrange.selTracks.add(this.selectedTrackId);
    Arrange.selRegions.clear(); PianoRoll.regionId = null;
    this.rebuildAudio();
    Transport.locate(0);
  },
  loadDemo() {
    Transport.stop();
    Project.load(buildDemoSong());
    this.selectedTrackId = Project.data.tracks[0].id;
    Arrange.selTracks.clear(); Arrange.selTracks.add(this.selectedTrackId);
    Arrange.selRegions.clear(); PianoRoll.regionId = null;
    this.rebuildAudio();
    Transport.locate(0);
    U.toast('デモソングを読み込みました');
  },
  async saveProject() {
    const nAssets = Object.keys(AudioPool.assets).length;
    if (nAssets) U.toast('オーディオを含めて書き出し中…', 60000);
    await new Promise(r => setTimeout(r, nAssets ? 30 : 0));
    try {
      const data = JSON.parse(JSON.stringify(Project.data));
      data.audioAssets = nAssets ? await AudioPool.serializeAsync(24) : undefined;
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      U.$('#toast-wrap').innerHTML = '';
      U.download((Project.data.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.logicx.json', blob);
      Project.dirty = false;
      U.toast('保存しました' + (nAssets ? ' (オーディオ ' + nAssets + ' 個を同梱 / ' +
              (blob.size / 1048576).toFixed(1) + ' MB)' : ''), 3200);
    } catch (e) {
      U.$('#toast-wrap').innerHTML = '';
      alert('保存に失敗しました: ' + e.message);
    }
  },
  openProjectFile() {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = '.json,.logicx,application/json';
    i.onchange = () => { if (i.files[0]) this.openProjectBlob(i.files[0]); };
    i.click();
  },

  async openProjectBlob(file) {
    try {
      U.toast('読み込み中…', 60000);
      const text = await file.text();
      const d = JSON.parse(text);
      if (!d.tracks) throw new Error('形式が違います');
      Transport.stop();
      const assets = d.audioAssets; delete d.audioAssets;
      await AudioPool.deserialize(assets);
      Project.load(d);
      this.selectedTrackId = d.tracks[0] && d.tracks[0].id;
      Arrange.selTracks.clear(); if (this.selectedTrackId) Arrange.selTracks.add(this.selectedTrackId);
      Arrange.selRegions.clear(); PianoRoll.regionId = null;
      WaveEditor.assetId = null; WaveEditor.regionId = null;
      this.rebuildAudio();
      U.$('#toast-wrap').innerHTML = '';
      U.toast('「' + (d.name || '無題') + '」を開きました');
    } catch (err) {
      U.$('#toast-wrap').innerHTML = '';
      alert('プロジェクトを読み込めませんでした: ' + err.message);
    }
  },
  saveLocal() {
    try {
      localStorage.setItem('logicx.project', Project.serialize());
      U.toast('ブラウザに保存しました');
    } catch (e) { U.toast('ブラウザ保存に失敗しました (' + e.name + ')'); }
  },
  loadLocal() {
    try {
      const s = localStorage.getItem('logicx.project');
      if (!s) { U.toast('保存されたプロジェクトがありません'); return; }
      Transport.stop();
      Project.load(JSON.parse(s));
      this.selectedTrackId = Project.data.tracks[0].id;
      Arrange.selTracks.clear(); Arrange.selTracks.add(this.selectedTrackId);
      this.rebuildAudio();
      U.toast('ブラウザ保存から復元しました');
    } catch (e) { U.toast('復元に失敗しました'); }
  },

  exportWavDialog() { return this.exportDialog(); },
  _legacyExportWavDialog() {
    Modal.show('オーディオを書き出す (WAV)', body => {
      body.__sr = 44100; body.__bits = 16; body.__range = 'all';
      body.appendChild(ipSelect('サンプルレート', '44100',
        [{ value: '44100', label: '44.1 kHz' }, { value: '48000', label: '48 kHz' }], v => body.__sr = +v));
      body.appendChild(ipSelect('ビット深度', '16',
        [{ value: '16', label: '16 bit' }, { value: '24', label: '24 bit' }], v => body.__bits = +v));
      body.appendChild(ipSelect('範囲', 'all',
        [{ value: 'all', label: 'プロジェクト全体' }, { value: 'cycle', label: 'サイクル範囲のみ' }], v => body.__range = v));
      body.appendChild(U.el('p', null, 'ミックス (EQ・エフェクト・センド・マスターリミッター) を含めてレンダリングします。'));
    }, [
      { label: 'キャンセル' },
      { label: '書き出す', primary: true, fn: async body => {
          Modal.hide();
          U.toast('レンダリング中…', 60000);
          setTimeout(async () => {
            try {
              const p = Project.data;
              const opts = { sampleRate: body.__sr };
              if (body.__range === 'cycle' && p.cycle.end > p.cycle.start) {
                opts.startBeat = p.cycle.start; opts.endBeat = p.cycle.end;
              }
              const buf = await Bounce.render(p, opts);
              const blob = encodeWav(buf, body.__bits);
              U.$('#toast-wrap').innerHTML = '';
              U.download((p.name || 'bounce').replace(/[\\/:*?"<>|]/g, '_') + '.wav', blob);
              U.toast('書き出し完了 (' + (blob.size / 1048576).toFixed(1) + ' MB)');
            } catch (e) {
              U.$('#toast-wrap').innerHTML = '';
              alert('書き出しに失敗しました: ' + e.message);
            }
          }, 60);
          return false;
        } }
    ]);
  },
  exportMidi() {
    try {
      const blob = MidiExport.build(Project.data);
      U.download((Project.data.name || 'project').replace(/[\\/:*?"<>|]/g, '_') + '.mid', blob);
      U.toast('MIDI ファイルを書き出しました');
    } catch (e) { alert('MIDI 書き出しに失敗しました: ' + e.message); }
  },


  /* ══════════════ アルペジエータ ══════════════ */
  arpDialog() {
    const id = Array.from(Arrange.selRegions)[0] || PianoRoll.regionId;
    const f = id && Project.region(id);
    if (!f) { U.toast('MIDI リージョンを選択してください'); return; }
    if (f.region.type === 'audio') { U.toast('MIDI リージョンを選択してください'); return; }
    Arp.dialog(f.region, f.track);
  },

  /* ══════════════ タイムストレッチ (小節に合わせる) ══════════════ */
  fitToBarsDialog() {
    const id = Array.from(Arrange.selRegions)[0];
    const f = id && Project.region(id);
    if (!f || f.region.type !== 'audio') { U.toast('オーディオリージョンを選択してください'); return; }
    const r = f.region;
    const a = AudioPool.get(r.audioId);
    if (!a) { U.toast('オーディオが見つかりません'); return; }

    const p = Project.data;
    const naturalSec = Math.max(0.01, a.buffer.duration - (r.offset || 0));
    const naturalBeats = naturalSec * p.tempo / 60;
    const suggest = Math.max(1, Math.round(naturalBeats / p.sigNum));

    Modal.show('小節に合わせる (タイムストレッチ)', body => {
      body.__bars = suggest;
      body.__method = 'stretch';
      body.appendChild(U.el('p', null,
        '現在の長さ: ' + naturalSec.toFixed(3) + ' 秒 = ' + naturalBeats.toFixed(2) + ' 拍 ' +
        '(約 ' + (naturalBeats / p.sigNum).toFixed(2) + ' 小節 @ ' + p.tempo + ' BPM)'));
      body.appendChild(ipRange('合わせる小節数', suggest, 1, Math.max(64, suggest * 2), 1,
        v => { body.__bars = Math.round(v); upd(); }, v => Math.round(v) + ' 小節'));
      body.appendChild(ipSelect('方式', 'stretch', [
        { value: 'stretch', label: 'タイムストレッチ (ピッチ保持・推奨)' },
        { value: 'vari', label: 'バリスピード (ピッチも変わる / テープ的)' }
      ], v => { body.__method = v; upd(); }));
      const info = U.el('p', 'exp-note');
      body.appendChild(info);
      const upd = () => {
        const targetSec = body.__bars * p.sigNum * 60 / p.tempo;
        const ratio = targetSec / naturalSec;
        let t = '伸縮率: ' + (ratio * 100).toFixed(1) + '%  (' + naturalSec.toFixed(2) + ' 秒 → ' + targetSec.toFixed(2) + ' 秒)';
        if (body.__method === 'stretch') {
          if (ratio < 0.5 || ratio > 2) t += ' ⚠ 0.5〜2.0 倍を超えると音質が劣化します。';
          else t += ' 良好な範囲です。';
        } else {
          t += '  ピッチ変化: ' + (-12 * Math.log2(ratio)).toFixed(2) + ' 半音';
        }
        info.textContent = t;
      };
      setTimeout(upd, 0);
    }, [
      { label: 'キャンセル' },
      { label: '実行', primary: true, fn: async body => {
          Modal.hide();
          const targetBeats = body.__bars * p.sigNum;
          const targetSec = targetBeats * 60 / p.tempo;
          const ratio = targetSec / naturalSec;
          Project.snapshot('小節に合わせる');
          if (body.__method === 'vari') {
            r.rate = naturalSec / targetSec;
            r.length = targetBeats;
            this.refreshAll();
            U.toast('バリスピードで ' + body.__bars + ' 小節に合わせました');
          } else {
            U.toast('タイムストレッチ処理中…', 120000);
            await new Promise(res => setTimeout(res, 40));
            try {
              const startS = Math.floor((r.offset || 0) * a.buffer.sampleRate);
              const srcBuf = startS > 0 ? AudioFX.crop(a.buffer, startS, a.buffer.length) : a.buffer;
              const nb = AudioFX.timeStretch(srcBuf, ratio);
              const asset = AudioPool.add(a.name + ' (' + body.__bars + 'bar)', nb, a.meta);
              r.audioId = asset.id; r.offset = 0; r.rate = 1; r.length = targetBeats;
              U.$('#toast-wrap').innerHTML = '';
              this.refreshAll();
              U.toast('タイムストレッチ完了 — ' + body.__bars + ' 小節にぴったり合わせました');
            } catch (e) {
              U.$('#toast-wrap').innerHTML = '';
              alert('タイムストレッチに失敗しました: ' + e.message);
            }
          }
          return false;
        } }
    ]);
  },

  /* ══════════════ ステム分割 ══════════════ */
  stemsDialog() {
    const id = Array.from(Arrange.selRegions)[0];
    const f = id && Project.region(id);
    const a = f && f.region.type === 'audio' && AudioPool.get(f.region.audioId);
    if (!a) { U.toast('オーディオリージョンを選択してください'); return; }

    Modal.show('ステム分割', body => {
      body.innerHTML =
        '<p><b>' + a.name + '</b> を ドラム / ベース / ボーカル / シンセ・ギター の 4 ステムに分割します。</p>' +
        '<h3>方式について</h3>' +
        '<p>本機能は <b>信号処理 (HPSS + Mid/Side + 帯域分割)</b> による分離です。' +
        'Demucs や Spleeter のような AI 分離ではありません — ' +
        'それらは数百 MB の学習済みモデルを必要とし、オフライン単体で動作する本ソフトには同梱できないためです。</p>' +
        '<p>そのため分離は<b>完全ではなく</b>、ステム間に多少のかぶりが残ります。' +
        'リミックス素材、練習用の抜き出し、パート確認などの用途には十分実用的です。</p>' +
        '<p style="color:#7b8798">長さ ' + a.buffer.duration.toFixed(1) + ' 秒 / ' +
        (a.buffer.sampleRate / 1000) + ' kHz — 処理時間の目安: ' +
        Math.max(2, Math.round(a.buffer.duration * 0.8)) + ' 秒前後</p>';
    }, [
      { label: 'キャンセル' },
      { label: '分割を実行', primary: true, fn: () => { this.runStems(f.region, a); return false; } }
    ]);
  },

  async runStems(region, asset) {
    Modal.hide();
    const bar = U.el('div', 'toast');
    bar.textContent = 'ステム分割中… 0%';
    U.$('#toast-wrap').appendChild(bar);
    try {
      const stems = await Stems.separate(asset.buffer, (p, label) => {
        bar.textContent = 'ステム分割中… ' + Math.round(p * 100) + '%  ' + (label || '');
      });
      Project.snapshot('ステム分割');
      const baseTrackIdx = Project.trackIndex(Project.region(region.id).track.id);
      stems.forEach((st, i) => {
        const nb = AudioFX.normalize(st.buffer, 0, st.buffer.length, -1.0);
        const na = AudioPool.add(asset.name + ' — ' + st.name, nb, asset.meta);
        const t = Project.addTrack({
          type: 'audio', name: st.name,
          color: U.COLORS[(baseTrackIdx + 1 + i) % U.COLORS.length]
        });
        const r = newAudioRegion(t.id, region.start, na.id, st.name, Project.data.tempo);
        r.length = region.length; r.offset = region.offset || 0; r.rate = region.rate || 1;
        t.regions.push(r);
      });
      bar.remove();
      this.rebuildAudio();
      U.toast('4 ステムに分割しました — 元トラックをミュートして確認してください', 4500);
    } catch (e) {
      bar.remove();
      alert('ステム分割に失敗しました: ' + e.message);
    }
  },

  /* ══════════════ プラグインフォーマットの説明 ══════════════ */
  showPluginInfo() {
    Modal.show('プラグインフォーマットについて', body => {
      body.innerHTML =
        '<h3>Windows でのプラグイン規格</h3>' +
        '<table class="kbd-table">' +
        '<tr><td>VST3</td><td>Windows / macOS / Linux の事実上の標準。Steinberg 提供、GPLv3 または独自ライセンス。<b>新規開発の第一選択</b></td></tr>' +
        '<tr><td>CLAP</td><td>Bitwig / u-he 発の新しいオープン規格 (MIT)。マルチスレッド対応・パラメータモジュレーションに強い。VST3 と併売が主流</td></tr>' +
        '<tr><td>VST2</td><td>旧規格。Steinberg が新規ライセンスを停止済み。<b>新規開発は不可</b></td></tr>' +
        '<tr><td>AAX</td><td>Pro Tools 専用。Avid の開発者登録が必要</td></tr>' +
        '<tr><td>AU (AudioUnit)</td><td><b>macOS 専用</b>。CoreAudio に依存するため Windows では動作しません</td></tr>' +
        '</table>' +
        '<h3>結論</h3>' +
        '<p>Mac の <b>AU をそのまま Windows で動かすことはできません</b>。' +
        'AU は macOS の CoreAudio / Component Manager に組み込まれた仕組みだからです。</p>' +
        '<p>Windows と Mac の両方で使えるようにするには、<b>ひとつのコードベースから ' +
        'VST3 (Win/Mac) と AU (Mac) を同時ビルド</b>するのが標準的な方法です。' +
        '<b>JUCE</b> (C++) を使えば AU / VST3 / CLAP / AAX / スタンドアロンを 1 プロジェクトから書き出せます。' +
        'ARM (M1/M2/M3) 対応も Universal Binary として同時に出力できます。</p>' +
        '<h3>本ソフト (Browser DAW) の場合</h3>' +
        '<p>本ソフトはブラウザのサンドボックス内で動作するため、' +
        '<b>ネイティブの VST3 / AU バイナリを読み込むことは原理的にできません</b> ' +
        '(OS のファイル実行権限がサンドボックスで遮断されるため)。</p>' +
        '<p>代わりに <b>内蔵プラグイン形式</b> を採用しています。' +
        'js/instruments.js・js/spectra.js (音源) と js/effects.js (エフェクト) に ' +
        '定義を追加するだけで、ライブラリとミキサーに自動的に現れます。</p>' +
        '<p>Web 標準で近い規格に <b>WAM (Web Audio Modules 2.0)</b> があります。' +
        'ネイティブ VST3 をホストしたい場合は、本ソフトを Electron / Tauri でラップし、' +
        'C++ 側に VST3 ホストを実装する構成が必要になります。</p>';
    });
  },

  /* ══════════════ ヘルプ ══════════════ */
  showShortcuts() {
    const M = U.isMac;
    const rows = [
      ['Space', '再生 / 停止'], ['Return', '先頭に戻る'], ['R', '録音'], ['C', 'サイクル オン/オフ'],
      ['K', 'メトロノーム'], [', / .', '1小節 戻る / 進む'], ['U', '選択範囲をサイクルに設定'],
      ['—', '—'],
      [M ? '⌘Z / ⇧⌘Z' : 'Ctrl+Z / Ctrl+Y', '取り消し / やり直し'],
      [M ? '⌘C / ⌘X / ⌘V' : 'Ctrl+C / X / V', 'コピー / カット / ペースト'],
      [M ? '⌘D' : 'Ctrl+D', '複製'], ['Delete', '削除'], [M ? '⌘A' : 'Ctrl+A', 'すべて選択'],
      [M ? '⌘T' : 'Ctrl+T', '再生ヘッド位置で分割'], [M ? '⌘J' : 'Ctrl+J', 'リージョン結合'],
      ['—', '—'],
      ['1 – 6', 'ツール切り替え (ポインタ/鉛筆/消しゴム/はさみ/接着/ミュート)'],
      ['P', 'ピアノロール'], ['X', 'ミキサー'], ['B', 'ステップシーケンサ'],
      ['I', 'インスペクタ'], ['Y', 'ライブラリ'], ['Z', '全体を表示'],
      ['Q', 'クオンタイズ (ピアノロール)'],
      ['↑ / ↓', '半音上げる / 下げる'], ['⇧↑ / ⇧↓', 'オクターブ上げる / 下げる'],
      ['—', '—'],
      [M ? '⌘K' : 'Ctrl+K', 'ミュージックタイピング オン/オフ'],
      ['A W S E D F T G Y H U J K', 'ミュージックタイピング時の鍵盤 (C→C)'],
      ['Z / X (タイピング時)', 'オクターブ 下げる / 上げる'],
      ['—', '—'],
      [M ? '⌘ドラッグ' : 'Ctrl+ドラッグ', '水平ズーム (アレンジ上のホイール)'],
      ['⌥ドラッグ', 'リージョン / ノートを複製しながら移動']
    ];
    Modal.show('キーボードショートカット', body => {
      const t = U.el('table', 'kbd-table');
      rows.forEach(([k, v]) => {
        const tr = U.el('tr');
        if (k === '—') { tr.innerHTML = '<td colspan="2" style="height:6px;border:none"></td>'; t.appendChild(tr); return; }
        tr.appendChild(U.el('td', null, k));
        tr.appendChild(U.el('td', null, v));
        t.appendChild(tr);
      });
      body.appendChild(t);
    });
  },
  showDrumMap() {
    Modal.show('ドラムマップ', body => {
      const t = U.el('table', 'kbd-table');
      Instruments.DRUM_MAP.forEach(d => {
        const tr = U.el('tr');
        tr.appendChild(U.el('td', null, U.noteName(d.midi) + '  (MIDI ' + d.midi + ')'));
        tr.appendChild(U.el('td', null, d.name));
        t.appendChild(tr);
      });
      body.appendChild(t);
    });
  },
  showGuide() {
    Modal.show('クイックスタート', body => {
      body.innerHTML =
        '<h3>1. 再生する</h3><p>Space キー、または再生ボタン。C キーでサイクル(ループ)再生。</p>' +
        '<h3>2. 音を編集する</h3><p>リージョンをダブルクリックするとピアノロールが開きます。' +
        '鉛筆ツール(2キー)でノートを描き、ドラッグで移動、右端をドラッグで長さ変更。</p>' +
        '<h3>3. 音色を変える</h3><p>ライブラリ(Yキー)からプリセットを選択。インスペクタ下部の' +
        '「音源パラメータ」でフィルタ・エンベロープ・LFO を直接調整できます。</p>' +
        '<h3>4. ミックスする</h3><p>Xキーでミキサー。EQ ノブ、インサートエフェクト、リバーブ/ディレイのセンドを操作します。</p>' +
        '<h3>5. 演奏・録音する</h3><p>⌨ ボタン (ミュージックタイピング) をオンにして A・S・D… キーで演奏。' +
        'トラックの ● を点灯させ R キーで録音します。</p>' +
        '<h3>6. 書き出す</h3><p>ファイル ▸ オーディオを書き出す (WAV) / MIDI ファイルを書き出す。</p>';
    });
  },
  showAbout() {
    Modal.show('Browser DAW について', body => {
      body.innerHTML =
        '<p style="font-size:14px"><b>Browser DAW</b> — ブラウザで動く音楽制作ワークスペース</p>' +
        '<p>Web Audio APIを利用した、完全自己完結型のDAWです。インストール不要で動作します。</p>' +
        '<h3>搭載機能</h3>' +
        '<p>マルチトラックアレンジ / ピアノロール / ステップシーケンサ / ミキサー / ' +
        '減算合成シンセ・FM音源・ドラムマシン / チャンネルEQ / 8種のインサートエフェクト / ' +
        'リバーブ・ディレイセンドバス / WAV・MIDI 書き出し / 取り消し・やり直し</p>' +
        '<p style="color:#8e8e97;font-size:11px;margin-top:14px">' +
        'サンプルレート: ' + (Engine.ctx ? Math.round(Engine.ctx.sampleRate) : '—') + ' Hz　/　' +
        'プラットフォーム: ' + (U.isMac ? 'macOS' : 'Windows / その他') + '</p>';
    });
  },


  /* ══════════════ オーディオ読み込み / ドラッグ＆ドロップ ══════════════ */
  bindDragDrop() {
    const dz = U.$('#dropzone');
    let depth = 0;
    const isFiles = e => e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0;

    window.addEventListener('dragenter', e => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth++; dz.classList.add('on');
    });
    window.addEventListener('dragover', e => { if (isFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
    window.addEventListener('dragleave', e => {
      if (!isFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (!depth) dz.classList.remove('on');
    });
    window.addEventListener('drop', async e => {
      if (!isFiles(e)) return;
      e.preventDefault(); depth = 0; dz.classList.remove('on');
      const files = Array.from(e.dataTransfer.files || []);
      if (!files.length) return;

      /* プロジェクトファイルなら開く */
      const proj = files.find(f => /\.json$/i.test(f.name));
      if (proj && files.length === 1) { this.openProjectBlob(proj); return; }

      /* ドロップ位置からトラックと拍を求める */
      const gw = U.$('#grid-wrap');
      const rect = gw.getBoundingClientRect();
      let track = null, beat = Transport.positionBeats;
      if (e.clientX >= rect.left && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        const y = e.clientY - rect.top + gw.scrollTop;
        const x = e.clientX - rect.left + gw.scrollLeft;
        beat = Arrange.snapBeat(Arrange.xToBeat(x));
        const ti = Arrange.trackAtY(y);
        const cand = ti >= 0 ? Project.data.tracks[ti] : null;
        if (cand && cand.type === 'audio') track = cand;
      }
      await this.importAudioFiles(files.filter(f => !/\.json$/i.test(f.name)), track, beat);
    });
  },

  async importAudioFiles(files, track, beat) {
    if (!files || !files.length) return;
    if (!Engine.ctx) { U.toast('先に「プロジェクトを開く」を押してください'); return; }
    await Engine.resume();
    U.toast('読み込み中…', 30000);
    Project.snapshot('オーディオ読み込み');
    let at = (beat == null) ? Transport.positionBeats : beat;
    let firstRegion = null;
    const errs = [];

    for (const f of files) {
      try {
        const asset = await AudioPool.importFile(f);
        let t = track;
        if (!t) {
          t = Project.addTrack({
            type: 'audio', name: asset.name,
            color: U.COLORS[Project.data.tracks.length % U.COLORS.length]
          });
          Engine.rebuild(Project.data);
          Engine.setMasterVolume(Project.data.masterVolume);
        }
        const r = newAudioRegion(t.id, at, asset.id, asset.name, Project.data.tempo);
        t.regions.push(r);
        if (!firstRegion) firstRegion = r;
        track = null;                    /* 2 つ目以降は新しいトラックへ */
        at = Math.max(at, r.start);
      } catch (err) {
        errs.push(f.name + ': ' + err.message);
      }
    }
    U.$('#toast-wrap').innerHTML = '';
    this.refreshAll();
    if (firstRegion) {
      Arrange.selRegions.clear(); Arrange.selRegions.add(firstRegion.id);
      Arrange.renderRegions();
      const f2 = Project.region(firstRegion.id);
      if (f2) Arrange.selectTrack(f2.track.id, false);
    }
    if (errs.length) alert('読み込めなかったファイル:\n' + errs.join('\n'));
    else U.toast(files.length + ' 個のオーディオを読み込みました');
  },

  openAudioDialog() {
    const i = document.createElement('input');
    i.type = 'file'; i.multiple = true;
    i.accept = '.wav,.wave,.aif,.aiff,.mp3,.m4a,.aac,.ogg,.oga,.flac,.opus,audio/*';
    i.onchange = () => this.importAudioFiles(Array.from(i.files), null, Transport.positionBeats);
    i.click();
  },

  addAudioTrack() {
    Project.snapshot('オーディオトラック追加');
    const t = Project.addTrack({
      type: 'audio', name: 'オーディオ ' + (Project.data.tracks.filter(x => x.type === 'audio').length + 1),
      color: U.COLORS[Project.data.tracks.length % U.COLORS.length]
    });
    this.rebuildAudio();
    Arrange.selectTrack(t.id, false);
    return t;
  },

  /* ══════════════ 書き出し ══════════════ */
  exportDialog() {
    const p = Project.data;
    Modal.show('オーディオを書き出す', body => {
      const pr = Engine.prefs;
      body.__format = 'wav';
      body.__rate = pr.exportRate || 48000;
      body.__bits = pr.exportBits || 24;
      body.__kbps = 320;
      body.__range = 'all';

      const fmtRow = ipSelect('フォーマット', 'wav', [
        { value: 'wav', label: 'WAV (非圧縮 / 高音質)' },
        { value: 'mp3', label: 'MP3 (圧縮)' }
      ], v => { body.__format = v; sync(); });
      body.appendChild(fmtRow);

      const rateRow = ipSelect('サンプルレート', String(body.__rate), [
        { value: '44100', label: '44.1 kHz (CD)' },
        { value: '48000', label: '48 kHz (標準・推奨)' },
        { value: '88200', label: '88.2 kHz (ハイレゾ)' },
        { value: '96000', label: '96 kHz (ハイレゾ)' }
      ], v => { body.__rate = +v; sync(); });
      body.appendChild(rateRow);

      const bitsRow = ipSelect('ビット深度', String(body.__bits), [
        { value: '16', label: '16 bit' },
        { value: '24', label: '24 bit (推奨)' },
        { value: '32', label: '32 bit float (無劣化)' }
      ], v => body.__bits = +v);
      body.appendChild(bitsRow);

      const kbpsRow = ipSelect('ビットレート', '320', [
        { value: '128', label: '128 kbps' }, { value: '192', label: '192 kbps' },
        { value: '256', label: '256 kbps' }, { value: '320', label: '320 kbps (最高音質)' }
      ], v => body.__kbps = +v);
      body.appendChild(kbpsRow);

      body.appendChild(ipSelect('範囲', 'all', [
        { value: 'all', label: 'プロジェクト全体' },
        { value: 'cycle', label: 'サイクル範囲のみ' }
      ], v => body.__range = v));

      const note = U.el('p', 'exp-note');
      body.appendChild(note);

      const sync = () => {
        const mp3 = body.__format === 'mp3';
        bitsRow.style.display = mp3 ? 'none' : '';
        kbpsRow.style.display = mp3 ? '' : 'none';
        let txt = 'ミックス (EQ・エフェクト・センド・マスターリミッター) を含めてレンダリングします。';
        if (mp3) {
          if (!mp3Available()) txt = '⚠ MP3 エンコーダが読み込まれていません (js/vendor/lame.min.js)。';
          else if (body.__rate > 48000) txt += ' MP3 の規格上、48 kHz に変換して書き出します。';
        } else if (body.__rate > (Engine.ctx ? Engine.ctx.sampleRate : 48000)) {
          txt += ' エンジンより高いレートを指定した場合、内部生成音は指定レートで再合成されます。';
        }
        note.textContent = txt;
      };
      sync();
    }, [
      { label: 'キャンセル' },
      { label: '書き出す', primary: true, fn: body => { this.runExport(body); return false; } }
    ]);
  },

  async runExport(o) {
    Modal.hide();
    const p = Project.data;
    const mp3 = o.__format === 'mp3';
    Engine.prefs.exportRate = o.__rate; Engine.prefs.exportBits = o.__bits; Engine.savePrefs();
    U.toast('レンダリング中…', 120000);
    await new Promise(r => setTimeout(r, 40));
    try {
      const opts = { sampleRate: o.__rate };
      if (o.__range === 'cycle' && p.cycle.end > p.cycle.start) {
        opts.startBeat = p.cycle.start; opts.endBeat = p.cycle.end;
      }
      let buf = await Bounce.render(p, opts);
      const base = (p.name || 'bounce').replace(/[\\/:*?"<>|]/g, '_');
      let blob, ext;
      if (mp3) {
        if (!mp3Available()) throw new Error('MP3 エンコーダが見つかりません');
        if (MP3_RATES.indexOf(buf.sampleRate) < 0) {
          U.$('#toast-wrap').innerHTML = ''; U.toast('48 kHz に変換中…', 60000);
          buf = await AudioFX.resample(buf, 48000);
        }
        U.$('#toast-wrap').innerHTML = ''; U.toast('MP3 エンコード中…', 120000);
        await new Promise(r => setTimeout(r, 30));
        blob = encodeMp3(buf, o.__kbps);
        ext = '.mp3';
      } else {
        blob = encodeWav(buf, o.__bits);
        ext = '.wav';
      }
      U.$('#toast-wrap').innerHTML = '';
      U.download(base + ext, blob);
      U.toast('書き出し完了 — ' + (blob.size / 1048576).toFixed(2) + ' MB / ' +
              (buf.sampleRate / 1000) + ' kHz' + (mp3 ? ' / ' + o.__kbps + ' kbps' : ' / ' + o.__bits + ' bit'), 4000);
    } catch (e) {
      U.$('#toast-wrap').innerHTML = '';
      alert('書き出しに失敗しました: ' + e.message);
    }
  },

  /* 波形エディタからの単体書き出し */
  exportBufferDialog(buffer, name, sel) {
    Modal.show('オーディオを書き出す — ' + name, body => {
      body.__format = 'wav'; body.__bits = 24; body.__kbps = 320; body.__rate = buffer.sampleRate;
      body.appendChild(ipSelect('フォーマット', 'wav',
        [{ value: 'wav', label: 'WAV' }, { value: 'mp3', label: 'MP3' }], v => { body.__format = v; sync(); }));
      const bitsRow = ipSelect('ビット深度', '24',
        [{ value: '16', label: '16 bit' }, { value: '24', label: '24 bit' }, { value: '32', label: '32 bit float' }],
        v => body.__bits = +v);
      body.appendChild(bitsRow);
      const kbpsRow = ipSelect('ビットレート', '320',
        [{ value: '128', label: '128 kbps' }, { value: '192', label: '192 kbps' },
         { value: '256', label: '256 kbps' }, { value: '320', label: '320 kbps' }], v => body.__kbps = +v);
      body.appendChild(kbpsRow);
      body.appendChild(ipSelect('サンプルレート', String(buffer.sampleRate), [
        { value: String(buffer.sampleRate), label: 'そのまま (' + (buffer.sampleRate / 1000) + ' kHz)' },
        { value: '44100', label: '44.1 kHz' }, { value: '48000', label: '48 kHz' },
        { value: '88200', label: '88.2 kHz' }, { value: '96000', label: '96 kHz' }
      ], v => body.__rate = +v));
      if (sel) body.appendChild(U.el('p', null, '選択範囲のみを書き出します。'));
      const sync = () => {
        const mp3 = body.__format === 'mp3';
        bitsRow.style.display = mp3 ? 'none' : '';
        kbpsRow.style.display = mp3 ? '' : 'none';
      };
      sync();
    }, [
      { label: 'キャンセル' },
      { label: '書き出す', primary: true, fn: async body => {
          Modal.hide();
          try {
            let buf = sel ? AudioFX.crop(buffer, sel.s, sel.e) : buffer;
            if (body.__rate !== buf.sampleRate) buf = await AudioFX.resample(buf, body.__rate);
            let blob, ext;
            if (body.__format === 'mp3') {
              if (MP3_RATES.indexOf(buf.sampleRate) < 0) buf = await AudioFX.resample(buf, 48000);
              blob = encodeMp3(buf, body.__kbps); ext = '.mp3';
            } else { blob = encodeWav(buf, body.__bits); ext = '.wav'; }
            U.download(name.replace(/[\\/:*?"<>|]/g, '_') + ext, blob);
            U.toast('書き出しました (' + (blob.size / 1048576).toFixed(2) + ' MB)');
          } catch (e) { alert('書き出しに失敗しました: ' + e.message); }
          return false;
        } }
    ]);
  },

  /* ══════════════ 設定 ══════════════ */
  audioPrefsDialog() {
    Modal.show('オーディオ設定', body => {
      const pr = Engine.prefs;
      body.__rate = pr.sampleRate; body.__low = pr.lowLatency;
      body.appendChild(ipSelect('エンジン サンプルレート', String(pr.sampleRate), [
        { value: '44100', label: '44.1 kHz' },
        { value: '48000', label: '48 kHz (推奨)' },
        { value: '88200', label: '88.2 kHz' },
        { value: '96000', label: '96 kHz' }
      ], v => body.__rate = +v));
      body.appendChild(ipCheck('低レイテンシモード', pr.lowLatency, v => body.__low = v));
      body.appendChild(ipCheck('録音レイテンシ補正', Project.data.latencyComp !== false,
        v => { Project.data.latencyComp = v; }));
      const info = U.el('pre', 'lat-detail', Latency.detail());
      body.appendChild(info);
      body.appendChild(U.el('p', null,
        '低レイテンシモードは出力バッファを最小 (通常 128 サンプル) にします。' +
        '音が途切れる場合はオフにしてください。'));
      body.appendChild(U.el('p', null,
        'サンプルレートを変更するとオーディオエンジンを作り直します (再生は停止します)。' +
        'デバイスが対応していないレートは自動的に近い値へ調整されます。'));
    }, [
      { label: 'キャンセル' },
      { label: '適用', primary: true, fn: async body => {
          Modal.hide();
          U.toast('オーディオエンジンを再構成中…', 20000);
          const sr = await Engine.reconfigure({ sampleRate: body.__rate, lowLatency: body.__low });
          U.$('#toast-wrap').innerHTML = '';
          this.refreshAll();
          this.updateLatencyUI();
          U.$('#engine-state').textContent = '● ENGINE ON  ' + Math.round(sr / 1000) + 'k';
          U.toast('サンプルレート: ' + sr + ' Hz / レイテンシ ' + Latency.text());
          return false;
        } }
    ]);
  },

  midiDialog() {
    Modal.show('MIDI 設定', body => {
      if (!Midi.supported) {
        body.appendChild(U.el('p', null,
          'このブラウザは Web MIDI に対応していません。Chrome / Edge をご利用ください。' +
          '(Safari は環境設定 ▸ 詳細 ▸ 機能フラグで有効化が必要です)'));
        return;
      }
      const list = U.el('div');
      list.style.cssText = 'border:1px solid #1a1f28;border-radius:8px;overflow:hidden;margin-bottom:10px;';
      if (!Midi.inputs.length) {
        list.appendChild(U.el('div', 'ip-empty', 'MIDI 入力デバイスが見つかりません'));
      } else {
        Midi.inputs.forEach(inp => {
          const row = U.el('div', 'lib-item');
          row.style.cssText = 'display:flex;align-items:center;gap:10px;cursor:default;';
          const cb = U.el('input'); cb.type = 'checkbox'; cb.checked = inp.enabled;
          cb.onchange = () => { Midi.setEnabled(inp.id, cb.checked); this.updateMidiUI(); };
          row.appendChild(cb);
          const nm = U.el('div');
          nm.innerHTML = '<b>' + inp.name + '</b>' +
            (inp.manufacturer ? '<br><span style="color:#7b8798;font-size:10px">' + inp.manufacturer + '</span>' : '');
          row.appendChild(nm);
          list.appendChild(row);
        });
      }
      body.appendChild(list);
      body.appendChild(ipSelect('受信チャンネル', String(Midi.channel),
        [{ value: '0', label: 'すべて (Omni)' }].concat(
          Array.from({ length: 16 }, (_, i) => ({ value: String(i + 1), label: 'Ch ' + (i + 1) }))),
        v => Midi.channel = +v));
      body.appendChild(ipSelect('ベロシティカーブ', Midi.velCurve, [
        { value: 'linear', label: 'リニア' }, { value: 'soft', label: 'ソフト (弱く弾いても出る)' },
        { value: 'hard', label: 'ハード (強く弾く必要)' }, { value: 'fixed', label: '固定値' }
      ], v => Midi.velCurve = v));
      body.appendChild(ipRange('固定ベロシティ', Midi.fixedVel, 1, 127, 1, v => Midi.fixedVel = Math.round(v), v => Math.round(v)));
      body.appendChild(ipRange('トランスポーズ', Midi.transpose, -24, 24, 1,
        v => Midi.transpose = Math.round(v), v => (v > 0 ? '+' : '') + Math.round(v)));
      body.appendChild(ipRange('ピッチベンド幅', Midi.bendRange, 1, 24, 1,
        v => Midi.bendRange = Math.round(v), v => '±' + Math.round(v) + ' 半音'));
      body.appendChild(ipButton('オールノートオフ (パニック)', () => Midi.panic()));
      body.appendChild(U.el('p', null,
        '演奏先は「録音待機 (●)」のトラック、無い場合は選択中のトラックです。'));
    });
  },

  showLatency() {
    Modal.show('レイテンシ', body => {
      body.appendChild(U.el('pre', 'lat-detail', Latency.detail()));
      const l = Latency.output();
      const total = l ? l.total : 0;
      const judge = total < 12 ? '非常に低い — 演奏に最適です'
                  : total < 22 ? '低い — 演奏に問題ありません'
                  : total < 40 ? 'やや大きい — 下記の対処をお試しください'
                  : '大きい — 下記の対処をお試しください';
      body.appendChild(U.el('h3', null, '評価: ' + judge));
      const comp = Transport.inputOffsetBeats();
      body.appendChild(U.el('p', null,
        '録音レイテンシ補正: ' + (Project.data.latencyComp !== false
          ? '有効 — 演奏を ' + (total).toFixed(1) + ' ms (' + comp.toFixed(3) + ' 拍) 前へずらして記録します。' +
            '体感の遅れは消えませんが、弾いたとおりのタイミングでグリッドに乗ります。'
          : '無効')));
      body.innerHTML +=
        '<h3>レイテンシを下げるには</h3>' +
        '<p>1. <b>オーディオ設定</b> で「低レイテンシモード」をオンにする（既定でオン）。</p>' +
        '<p>2. Windows: サウンド設定でデバイスの既定フォーマットを <b>48000 Hz</b> に合わせる。' +
        'Bluetooth ではなく有線のヘッドホン／オーディオインターフェイスを使う。</p>' +
        '<p>3. 付属の <b>browser-daw.bat / browser-daw.command</b> から起動する（アプリモード＋スロットリング無効化フラグ付き）。</p>' +
        '<p>4. 他のタブ・拡張機能を閉じる。ブラウザ拡張は MIDI 処理を遅らせることがあります。</p>' +
        '<p>5. ミキサーや波形エディタを閉じると描画負荷が下がります。</p>' +
        '<p style="color:#7b8798">参考: ネイティブ ASIO ドライバの DAW は 3〜7 ms 程度、' +
        'ブラウザ (WASAPI / CoreAudio 共有モード) は 8〜25 ms 程度が一般的な範囲です。</p>';
    });
  },

  /* ══════════════ キーボード ══════════════ */
  toggleTyping(force) {
    this.typing = force != null ? force : !this.typing;
    U.$('#btn-typing').classList.toggle('active', this.typing);
    if (!this.typing) this.allNotesOff();
    else U.toast('ミュージックタイピング: オン (A S D F… で演奏 / Z X でオクターブ)');
  },
  allNotesOff() {
    this._held.forEach((v, k) => this.noteOffKey(k));
    this._held.clear();
  },

  KEYMAP: { a:0, w:1, s:2, e:3, d:4, f:5, t:6, g:7, y:8, h:9, u:10, j:11,
            k:12, o:13, l:14, p:15, ';':16, "'":17, ']':18 },

  noteOnKey(key) {
    if (this._held.has(key)) return;
    const off = this.KEYMAP[key];
    if (off == null) return;
    const pitch = U.clamp(12 * this.octave + off, 0, 127);
    const t = Project.data.tracks.find(x => x.armed) ||
              Project.track(this.selectedTrackId) || Project.data.tracks[0];
    if (!t) return;
    const inst = Engine.instrument(t.id);
    if (inst) inst.noteOn(pitch, Engine.ctx.currentTime, 100);
    const rec = Transport.state === 'recording'
      ? { pitch, start: Transport.nowInput(), vel: 100 } : null;
    this._held.set(key, { pitch, trackId: t.id, rec });
  },
  noteOffKey(key) {
    const h = this._held.get(key);
    if (!h) return;
    this._held.delete(key);
    const inst = Engine.instrument(h.trackId);
    if (inst) inst.noteOff(h.pitch, Engine.ctx.currentTime);
    if (h.rec && Transport.state === 'recording') {
      const len = Math.max(0.05, Transport.nowInput() - h.rec.start);
      this._recBuf.push({ pitch: h.pitch, start: h.rec.start, length: len, vel: h.rec.vel });
    }
  },

  bindKeyboard() {
    window.addEventListener('keydown', e => {
      const tgt = e.target;
      if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.tagName === 'SELECT' ||
                  tgt.isContentEditable)) return;
      if (!U.$('#splash').classList.contains('hidden')) return;

      const k = e.key.toLowerCase();
      const mod = U.cmd(e);

      /* ── 修飾キー付き ── */
      if (mod) {
        switch (k) {
          case 'z': e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return;
          case 'y': e.preventDefault(); this.redo(); return;
          case 'c': e.preventDefault(); this.copy(); return;
          case 'x': e.preventDefault(); this.cut(); return;
          case 'v': e.preventDefault(); this.paste(); return;
          case 'd': e.preventDefault();
            if (this.inPianoRoll()) PianoRoll.duplicateSelected(); else this.duplicateRegions(); return;
          case 'a': e.preventDefault(); this.selectAll(); return;
          case 's': e.preventDefault(); this.saveProject(); return;
          case 'o': e.preventDefault(); this.openProjectFile(); return;
          case 'n': e.preventDefault();
            if (e.altKey) this.addTrackDialog(); else this.newProject(); return;
          case 'e': e.preventDefault(); this.exportDialog(); return;
          case 'i': if (e.shiftKey) { e.preventDefault(); this.openAudioDialog(); return; } break;
          case 't': e.preventDefault(); this.splitAtPlayhead(); return;
          case 'j': e.preventDefault(); this.glueSelection(); return;
          case 'k': e.preventDefault(); this.toggleTyping(); return;
        }
        return;
      }

      /* ── ミュージックタイピング ── */
      if (this.typing && !e.repeat) {
        if (k === 'z') { this.octave = U.clamp(this.octave - 1, 0, 8); U.toast('オクターブ C' + this.octave); return; }
        if (k === 'x') { this.octave = U.clamp(this.octave + 1, 0, 8); U.toast('オクターブ C' + this.octave); return; }
        if (this.KEYMAP[k] != null) { e.preventDefault(); this.noteOnKey(k); return; }
      }

      /* ── 単独キー ── */
      switch (e.key) {
        case ' ': e.preventDefault(); Transport.toggle(); return;
        case 'Enter': e.preventDefault(); Transport.locate(0); return;
        case 'Delete': case 'Backspace': e.preventDefault(); this.deleteSelection(); return;
        case 'ArrowLeft':  e.preventDefault(); Transport.nudgeBars(-1); return;
        case 'ArrowRight': e.preventDefault(); Transport.nudgeBars(1); return;
        case 'ArrowUp':    e.preventDefault();
          if (this.inPianoRoll()) PianoRoll.transpose(e.shiftKey ? 12 : 1);
          else this.regionOp(r => r.transpose = (r.transpose || 0) + (e.shiftKey ? 12 : 1));
          return;
        case 'ArrowDown':  e.preventDefault();
          if (this.inPianoRoll()) PianoRoll.transpose(e.shiftKey ? -12 : -1);
          else this.regionOp(r => r.transpose = (r.transpose || 0) - (e.shiftKey ? 12 : 1));
          return;
        case '?': this.showShortcuts(); return;
      }

      switch (k) {
        case 'r': e.preventDefault(); this.toggleRecord(); break;
        case 'c': this.toggleCycle(); break;
        case 'k': Project.data.metronome = !Project.data.metronome;
                  U.$('#btn-metronome').classList.toggle('active', Project.data.metronome); break;
        case ',': Transport.nudgeBars(-1); break;
        case '.': Transport.nudgeBars(1); break;
        case 'u': this.cycleToSelection(); break;
        case 'p': this.toggleEditor('pianoroll'); break;
        case 'x': this.toggleEditor('mixer'); break;
        case 'b': this.toggleEditor('stepseq'); break;
        case 'w': this.toggleEditor('wave'); break;
        case 'a': this.arpDialog(); break;
        case 'g': this.fitToBarsDialog(); break;
        case 's': this.openSpectra(); break;
        case 'i': this.togglePane('inspector'); break;
        case 'y': this.togglePane('library'); break;
        case 'z': this.zoomToFit(); break;
        case 'q': if (!U.$('#view-pianoroll').classList.contains('hidden')) PianoRoll.quantize(); break;
        case 'm': if (e.shiftKey) MasteringUI.toggle(); else this.regionOp(r => r.mute = !r.mute); break;
        case '1': Arrange.setTool('pointer'); break;
        case '2': Arrange.setTool('pencil'); break;
        case '3': Arrange.setTool('eraser'); break;
        case '4': Arrange.setTool('scissors'); break;
        case '5': Arrange.setTool('glue'); break;
        case '6': Arrange.setTool('mute'); break;
      }
    });

    window.addEventListener('keyup', e => {
      const k = e.key.toLowerCase();
      if (this._held.has(k)) this.noteOffKey(k);
    });
    window.addEventListener('blur', () => this.allNotesOff());
    /* リージョンのダブルクリックでピアノロール */
    U.$('#grid-wrap').addEventListener('dblclick', e => {
      const el = e.target.closest('.region');
      if (el) this.openRegion(el.dataset.id);
    });
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
