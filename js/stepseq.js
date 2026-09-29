/* ══════════════════════════════════════════════════════════════
   stepseq.js — ステップシーケンサ (ドラム / メロディ兼用)
   ══════════════════════════════════════════════════════════════ */
'use strict';

const StepSeq = {
  bars: 2,
  stepsPerBeat: 4,
  _inited: false,

  init() {
    U.$('#ss-bars').addEventListener('change', e => { this.bars = +e.target.value; this.render(); });
    U.$('#ss-clear').onclick = () => {
      const r = this.region(); if (!r) return;
      Project.snapshot('ステップクリア');
      r.notes = r.notes.filter(n => n.start >= this.totalBeats());
      this.render(); App.refreshArrangeOnly();
    };
    U.$('#ss-rand').onclick = () => this.randomize();
    this._inited = true;
  },

  totalBeats() { return this.bars * Project.data.sigNum; },
  totalSteps() { return this.totalBeats() * this.stepsPerBeat; },

  region() {
    if (PianoRoll.regionId) {
      const f = Project.region(PianoRoll.regionId);
      if (f) return f.region;
    }
    const t = Project.track(App.selectedTrackId);
    if (t && t.regions.length) return t.regions[0];
    return null;
  },
  track() {
    if (PianoRoll.regionId) { const f = Project.region(PianoRoll.regionId); if (f) return f.track; }
    return Project.track(App.selectedTrackId);
  },

  rows() {
    const t = this.track();
    if (!t) return [];
    if (Instruments.isDrum(t.instrument)) {
      return Instruments.DRUM_MAP.map(d => ({ pitch: d.midi, label: d.name }));
    }
    /* メロディトラック: 2オクターブ (C3〜B4) を上から */
    const out = [];
    for (let p = 84; p >= 48; p--) out.push({ pitch: p, label: U.noteName(p) });
    return out;
  },

  render() {
    if (!this._inited) return;
    const body = U.$('#ss-body');
    body.innerHTML = '';
    const t = this.track(), r = this.region();
    if (!t || !r) {
      body.appendChild(U.el('div', 'ip-empty', 'トラックとリージョンを選択してください'));
      return;
    }
    const steps = this.totalSteps();
    const stepBeat = 1 / this.stepsPerBeat;
    const rows = this.rows();

    rows.forEach(row => {
      const d = U.el('div', 'ss-row');
      d.appendChild(U.el('div', 'ss-label', row.label));
      for (let s = 0; s < steps; s++) {
        const beat = s * stepBeat;
        const n = r.notes.find(x => Math.abs(x.start - beat) < 1e-6 && x.pitch === row.pitch);
        const b = U.el('button', 'ss-step' + (s % this.stepsPerBeat === 0 ? ' beat' : '') +
          (n ? ' on' : '') + (n && n.vel > 105 ? ' acc' : ''));
        b.dataset.step = s; b.dataset.pitch = row.pitch;
        b.onclick = e => {
          Project.snapshot('ステップ編集');
          if (n) {
            if (e.shiftKey || n.vel > 105) r.notes.splice(r.notes.indexOf(n), 1);
            else n.vel = 118;
          } else {
            r.notes.push(newNote(row.pitch, beat, stepBeat * 0.9, 96));
            const inst = Engine.instrument(t.id);
            if (inst) inst.noteOn(row.pitch, Engine.ctx.currentTime, 96, 0.3);
          }
          if (r.length < this.totalBeats()) r.length = this.totalBeats();
          this.render(); App.refreshArrangeOnly(); PianoRoll.render();
        };
        d.appendChild(b);
      }
      body.appendChild(d);
    });
  },

  randomize() {
    const t = this.track(), r = this.region();
    if (!t || !r) return;
    Project.snapshot('ランダム生成');
    const steps = this.totalSteps(), sb = 1 / this.stepsPerBeat;
    r.notes = r.notes.filter(n => n.start >= this.totalBeats());
    if (Instruments.isDrum(t.instrument)) {
      for (let s = 0; s < steps; s++) {
        const beat = s * sb;
        if (s % 4 === 0 && Math.random() < 0.85) r.notes.push(newNote(36, beat, sb, 110));
        if (s % 8 === 4 && Math.random() < 0.9)  r.notes.push(newNote(38, beat, sb, 104));
        if (Math.random() < 0.55) r.notes.push(newNote(42, beat, sb * .8, 60 + Math.round(Math.random() * 40)));
        if (Math.random() < 0.08) r.notes.push(newNote(39, beat, sb, 90));
      }
    } else {
      const scale = [0, 2, 3, 5, 7, 8, 10];
      for (let s = 0; s < steps; s++) {
        if (Math.random() < 0.42) {
          const p = 57 + scale[Math.floor(Math.random() * scale.length)] + (Math.random() < 0.3 ? 12 : 0);
          r.notes.push(newNote(p, s * sb, sb * 0.9, 80 + Math.round(Math.random() * 40)));
        }
      }
    }
    if (r.length < this.totalBeats()) r.length = this.totalBeats();
    this.render(); App.refreshArrangeOnly(); PianoRoll.render();
  },

  /* 再生位置ハイライト */
  highlight() {
    if (U.$('#view-stepseq').classList.contains('hidden')) return;
    const r = this.region(); if (!r) return;
    const b = (Transport.isPlaying() ? Transport.now() : Transport.positionBeats) - r.start;
    const total = this.totalBeats();
    const rel = ((b % total) + total) % total;
    const cur = Math.floor(rel * this.stepsPerBeat);
    U.$$('#ss-body .ss-step.playing').forEach(e => e.classList.remove('playing'));
    if (!Transport.isPlaying()) return;
    U.$$('#ss-body .ss-step[data-step="' + cur + '"]').forEach(e => e.classList.add('playing'));
  }
};

window.StepSeq = StepSeq;
