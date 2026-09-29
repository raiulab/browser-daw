/* ══════════════════════════════════════════════════════════════
   project.js — プロジェクトデータモデル / デモソング / 取り消し
   ══════════════════════════════════════════════════════════════ */
'use strict';

function newTrack(opts) {
  opts = opts || {};
  const idx = opts.index || 0;
  return {
    id: U.uid('trk'),
    type: opts.type || 'midi',            /* 'midi' | 'audio' */
    name: opts.name || ('トラック ' + (idx + 1)),
    color: opts.color || U.COLORS[idx % U.COLORS.length],
    instrument: opts.instrument || Instruments.fromPreset('Classic Lead'),
    volume: opts.volume != null ? opts.volume : 0.72,
    pan: opts.pan || 0,
    mute: false, solo: false, armed: false,
    height: opts.height || 76,
    eq: { low: 0, mid: 0, midFreq: 1200, high: 0, hp: 20 },
    sends: { reverb: opts.reverb != null ? opts.reverb : 0.06, delay: opts.delay || 0 },
    inserts: opts.inserts || [],
    regions: []
  };
}

function newRegion(trackId, start, length, name) {
  return {
    id: U.uid('rgn'),
    type: 'midi',
    name: name || 'リージョン',
    start, length,
    loop: 0,          // 追加ループ回数
    mute: false,
    transpose: 0,
    velocityScale: 1,
    notes: []
  };
}
/* オーディオリージョン */
function newAudioRegion(trackId, start, audioId, name, tempo) {
  const a = AudioPool.get(audioId);
  const secs = a ? a.buffer.duration : 1;
  const beats = secs * (tempo || 120) / 60;
  return {
    id: U.uid('rgn'),
    type: 'audio',
    name: name || (a ? a.name : 'オーディオ'),
    audioId,
    start, length: beats,
    offset: 0,          /* バッファ内の開始位置 (秒) */
    gain: 1, pan: 0, rate: 1, detune: 0,
    fadeIn: 0, fadeOut: 0,
    loop: 0, mute: false,
    notes: []
  };
}

function newNote(pitch, start, length, vel) {
  return { id: U.uid('n'), pitch, start, length, vel: vel == null ? 96 : vel };
}

/* ══════════════════ Project ══════════════════ */
const Project = {
  data: null,
  undoStack: [],
  redoStack: [],
  dirty: false,

  blank(name) {
    return {
      version: 1,
      name: name || '名称未設定プロジェクト',
      tempo: 120,
      sigNum: 4, sigDen: 4,
      division: 0.25,
      masterVolume: 0.46,
      lengthBars: 32,
      cycle: { on: false, start: 0, end: 16 },
      metronome: false, countIn: false, latencyComp: true,
      playhead: 0,
      mastering: JSON.parse(JSON.stringify(MASTERING_DEFAULTS)),
      fxBus: {
        reverb: { size: 2.4, decay: 2.6, damp: 0.42, preDelay: 22, tone: 7200, level: 0.9 },
        delay:  { division: 0.5, feedback: 0.34, tone: 4200, level: 0.85 }
      },
      tracks: [],
      markers: []
    };
  },

  load(d) {
    /* 古い / 部分的なプロジェクトデータを安全な完全形に補完する */
    d.sigNum = d.sigNum || 4; d.sigDen = d.sigDen || 4;
    d.tempo = d.tempo || 120;
    d.markers = d.markers || [];
    if (d.latencyComp === undefined) d.latencyComp = true;
    d.cycle = d.cycle || { on: false, start: 0, end: 16 };
    d.fxBus = deepMerge(this.blank().fxBus, d.fxBus);
    d.mastering = deepMerge(MASTERING_DEFAULTS, d.mastering);
    (d.tracks || []).forEach(t => {
      t.type = t.type || 'midi';
      t.instrument = Instruments.normalize(t.instrument);
      t.eq = Object.assign({ low: 0, mid: 0, midFreq: 1200, high: 0, hp: 20 }, t.eq);
      t.sends = Object.assign({ reverb: 0, delay: 0 }, t.sends);
      t.inserts = t.inserts || [];
      t.regions = t.regions || [];
      t.regions.forEach(r => {
        r.type = r.type || (r.audioId ? 'audio' : 'midi');
        r.notes = r.notes || [];
        if (r.type === 'audio') {
          if (r.gain == null) r.gain = 1;
          if (r.rate == null) r.rate = 1;
          if (r.offset == null) r.offset = 0;
          if (r.fadeIn == null) r.fadeIn = 0;
          if (r.fadeOut == null) r.fadeOut = 0;
        }
      });
      t.height = t.height || 76;
      if (t.volume == null) t.volume = 0.72;
      if (t.pan == null) t.pan = 0;
    });
    this.data = d;
    this.undoStack = []; this.redoStack = [];
    this.dirty = false;
  },

  /* ── 取り消し / やり直し ── */
  snapshot(label) {
    if (!this.data) return;
    this.undoStack.push({ label: label || '操作', json: JSON.stringify(this.data) });
    if (this.undoStack.length > 80) this.undoStack.shift();
    this.redoStack.length = 0;
    this.dirty = true;
  },
  undo() {
    if (!this.undoStack.length) { U.toast('取り消せる操作がありません'); return false; }
    const s = this.undoStack.pop();
    this.redoStack.push({ label: s.label, json: JSON.stringify(this.data) });
    this.data = JSON.parse(s.json);
    U.toast('取り消し: ' + s.label);
    return true;
  },
  redo() {
    if (!this.redoStack.length) { U.toast('やり直せる操作がありません'); return false; }
    const s = this.redoStack.pop();
    this.undoStack.push({ label: s.label, json: JSON.stringify(this.data) });
    this.data = JSON.parse(s.json);
    U.toast('やり直し: ' + s.label);
    return true;
  },

  /* ── アクセサ ── */
  track(id) { return this.data.tracks.find(t => t.id === id); },
  trackIndex(id) { return this.data.tracks.findIndex(t => t.id === id); },
  region(id) {
    for (const t of this.data.tracks) {
      const r = t.regions.find(r => r.id === id);
      if (r) return { region: r, track: t };
    }
    return null;
  },
  allRegions() {
    const out = [];
    this.data.tracks.forEach(t => t.regions.forEach(r => out.push({ region: r, track: t })));
    return out;
  },

  addTrack(opts) {
    opts = opts || {};
    opts.index = this.data.tracks.length;
    const t = newTrack(opts);
    this.data.tracks.push(t);
    return t;
  },
  removeTrack(id) {
    const i = this.trackIndex(id);
    if (i >= 0) this.data.tracks.splice(i, 1);
  },

  /* プロジェクト全長 (拍) */
  lengthBeats() {
    let max = this.data.lengthBars * this.data.sigNum;
    this.allRegions().forEach(({ region }) => {
      const end = region.start + region.length * (1 + region.loop);
      if (end > max) max = end;
    });
    return max + this.data.sigNum * 2;
  },
  regionEnd(r) { return r.start + r.length * (1 + r.loop); },

  beatsToSec(b) { return b * 60 / this.data.tempo; },
  secToBeats(s) { return s * this.data.tempo / 60; },

  serialize() { return JSON.stringify(this.data, null, 1); }
};

/* ══════════════════ デモソング ══════════════════ */
function buildDemoSong() {
  const p = Project.blank('Browser DAW Demo — "Nightfall"');
  p.tempo = 112;
  p.lengthBars = 32;
  p.cycle = { on: false, start: 0, end: 32 };
  p.markers = [
    { pos: 0,  name: 'イントロ' },
    { pos: 32, name: 'A メロ' },
    { pos: 64, name: 'サビ' },
    { pos: 96, name: 'アウトロ' }
  ];

  const S = 4;  // 1小節 = 4拍
  const chordBars = [
    { root: 45, notes: [57, 60, 64], name: 'Am' },
    { root: 41, notes: [53, 57, 60], name: 'F'  },
    { root: 48, notes: [55, 60, 64], name: 'C'  },
    { root: 43, notes: [55, 59, 62], name: 'G'  }
  ];

  /* ── ドラム ── */
  const drums = Project.addTrack.call({ data: p }, {
    name: 'Drum Kit', instrument: Instruments.fromPreset('Acoustic Kit'),
    color: U.COLORS[4], volume: 0.70, reverb: 0.05, height: 76
  });
  {
    const r = newRegion(drums.id, 0, 8 * S, 'Beat');
    r.loop = 3;
    for (let bar = 0; bar < 8; bar++) {
      const b0 = bar * S;
      /* キック */
      [0, 1.5, 2, 3.5].forEach((o, i) => r.notes.push(newNote(36, b0 + o, .25, i === 0 ? 118 : 96)));
      if (bar % 4 === 3) r.notes.push(newNote(36, b0 + 3.75, .2, 88));
      /* スネア */
      [1, 3].forEach(o => r.notes.push(newNote(38, b0 + o, .25, 108)));
      if (bar % 8 === 7) { r.notes.push(newNote(38, b0 + 3.25, .2, 84)); r.notes.push(newNote(38, b0 + 3.5, .2, 96)); r.notes.push(newNote(38, b0 + 3.75, .2, 112)); }
      /* ハイハット */
      for (let s = 0; s < 8; s++) {
        const on = b0 + s * 0.5;
        const open = (s === 7 && bar % 2 === 1);
        r.notes.push(newNote(open ? 46 : 42, on, .2, s % 2 === 0 ? 84 : 62));
      }
      /* クラップ */
      if (bar % 2 === 1) r.notes.push(newNote(39, b0 + 3, .25, 92));
      /* クラッシュ */
      if (bar % 8 === 0) r.notes.push(newNote(49, b0, 1, 100));
    }
    drums.regions.push(r);
  }

  /* ── ベース ── */
  const bass = Project.addTrack.call({ data: p }, {
    name: 'Fat Bass', instrument: Instruments.fromPreset('Fat Saw Bass'),
    color: U.COLORS[2], volume: 0.50, reverb: 0.02, height: 76
  });
  {
    const r = newRegion(bass.id, 0, 8 * S, 'Bassline');
    r.loop = 3;
    for (let bar = 0; bar < 8; bar++) {
      const c = chordBars[bar % 4], b0 = bar * S;
      const pat = [0, 0.75, 1.5, 2, 2.75, 3.5];
      pat.forEach((o, i) => {
        const oct = (i === 4) ? 12 : 0;
        r.notes.push(newNote(c.root + oct, b0 + o, 0.42, i === 0 ? 112 : 88));
      });
    }
    bass.regions.push(r);
  }

  /* ── コード (エレピ) ── */
  const keys = Project.addTrack.call({ data: p }, {
    name: 'Electric Piano', instrument: Instruments.fromPreset('Electric Piano'),
    color: U.COLORS[0], volume: 0.50, reverb: 0.20, delay: 0.10, height: 76
  });
  {
    const r = newRegion(keys.id, 0, 8 * S, 'Chords');
    r.loop = 3;
    for (let bar = 0; bar < 8; bar++) {
      const c = chordBars[bar % 4], b0 = bar * S;
      const hits = [0, 0.5, 1.5, 2.5, 3];
      hits.forEach((o, i) => {
        c.notes.forEach((n, j) => {
          r.notes.push(newNote(n + (i === 3 ? 12 : 0), b0 + o, i === 0 ? 1.1 : 0.42,
            (i === 0 ? 98 : 74) - j * 4));
        });
      });
    }
    keys.regions.push(r);
  }

  /* ── パッド ── */
  const pad = Project.addTrack.call({ data: p }, {
    name: 'Warm Pad', instrument: Instruments.fromPreset('Cosmic Pad'),
    color: U.COLORS[5], volume: 0.38, reverb: 0.42, height: 76
  });
  {
    const r = newRegion(pad.id, 0, 8 * S, 'Pad');
    r.loop = 3;
    for (let bar = 0; bar < 8; bar++) {
      const c = chordBars[bar % 4], b0 = bar * S;
      c.notes.forEach((n, j) => r.notes.push(newNote(n + 12, b0, S - 0.05, 72 - j * 6)));
      r.notes.push(newNote(c.root + 12, b0, S - 0.05, 60));
    }
    pad.regions.push(r);
  }

  /* ── リード (16小節目から) ── */
  const lead = Project.addTrack.call({ data: p }, {
    name: 'Lead Synth', instrument: Instruments.fromPreset('Neon Supersaw'),
    color: U.COLORS[3], volume: 0.46, reverb: 0.24, delay: 0.28, height: 76
  });
  {
    const r = newRegion(lead.id, 16 * S, 8 * S, 'Melody');
    r.loop = 1;
    const mel = [
      [0, 69, 1], [1, 72, .5], [1.5, 76, 1.5], [3, 74, 1],
      [4, 72, .75], [4.75, 69, .5], [5.5, 67, 1.5], [7, 69, 1],
      [8, 72, 1], [9, 76, .5], [9.5, 79, 1.5], [11, 76, 1],
      [12, 74, .75], [12.75, 72, .5], [13.5, 74, 2],
      [16, 69, 1], [17, 72, .5], [17.5, 76, 1.5], [19, 81, 1],
      [20, 79, .75], [20.75, 76, .5], [21.5, 74, 1.5], [23, 72, 1],
      [24, 71, 1], [25, 74, .5], [25.5, 79, 1.5], [27, 76, 1],
      [28, 74, .5], [28.5, 72, .5], [29, 69, 3]
    ];
    mel.forEach(([st, pt, ln]) => r.notes.push(newNote(pt, st, ln, 92 + Math.round(Math.random() * 14))));
    lead.regions.push(r);
  }

  /* ── アルペジオ ── */
  const arp = Project.addTrack.call({ data: p }, {
    name: 'Arp Bells', instrument: Instruments.fromPreset('Glass Bells'),
    color: U.COLORS[6], volume: 0.28, reverb: 0.38, delay: 0.34, height: 76
  });
  {
    const r = newRegion(arp.id, 8 * S, 8 * S, 'Arp');
    r.loop = 2;
    for (let bar = 0; bar < 8; bar++) {
      const c = chordBars[bar % 4], b0 = bar * S;
      const seq = [c.notes[0] + 12, c.notes[1] + 12, c.notes[2] + 12, c.notes[1] + 24,
                   c.notes[2] + 12, c.notes[1] + 12, c.notes[0] + 12, c.notes[2] + 24];
      for (let s = 0; s < 16; s++) {
        r.notes.push(newNote(seq[s % 8], b0 + s * 0.25, 0.22, 62 + (s % 4 === 0 ? 22 : 0)));
      }
    }
    arp.regions.push(r);
  }

  /* インサートFX の例 */
  bass.inserts = [FX.defaultData('comp')];
  bass.inserts[0].params.threshold = -18; bass.inserts[0].params.ratio = 5;
  lead.inserts = [FX.defaultData('chorus')];
  drums.inserts = [FX.defaultData('comp')];
  drums.inserts[0].params.threshold = -14; drums.inserts[0].params.ratio = 3.4;

  return p;
}

window.Project = Project;
window.newTrack = newTrack;
window.newRegion = newRegion;
window.newAudioRegion = newAudioRegion;
window.newNote = newNote;
window.buildDemoSong = buildDemoSong;
