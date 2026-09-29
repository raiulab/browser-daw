/* ══════════════════════════════════════════════════════════════
   midi.js — Web MIDI 入力 / 超低レイテンシ演奏経路 / レイテンシ計測

   設計方針 (レイテンシ最小化):
     ・MIDI メッセージは受信ハンドラ内で「同期的に」発音する。
       キューやタイマーを一切挟まない。
     ・発音時刻は ctx.currentTime ちょうど (先読みオフセット 0)。
     ・AudioContext は latencyHint = 0 (最小バッファ) で生成。
     ・波形テーブル等は起動時にプリウォームし、初回発音での
       生成コスト (グリッチ要因) を排除する。
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Midi = {
  access: null,
  inputs: [],            /* {id, name, manufacturer, enabled} */
  supported: !!navigator.requestMIDIAccess,
  channel: 0,            /* 0 = 全チャンネル受信 */
  velCurve: 'linear',    /* linear | soft | hard | fixed */
  fixedVel: 100,
  transpose: 0,
  bend: 0,               /* 半音 */
  bendRange: 2,
  modWheel: 0,
  sustain: false,
  activeNotes: new Map(),   /* midi -> trackId */
  _sustained: new Set(),
  lastEventMs: 0,
  stats: { count: 0, lastJitter: 0, avgHandle: 0 },

  async init() {
    if (!this.supported) return false;
    try {
      this.access = await navigator.requestMIDIAccess({ sysex: false });
    } catch (e) {
      return false;
    }
    this.refresh();
    this.access.onstatechange = () => { this.refresh(); if (App.onMidiDevices) App.onMidiDevices(); };
    return true;
  },

  refresh() {
    if (!this.access) return;
    const prev = {};
    this.inputs.forEach(i => prev[i.id] = i.enabled);
    this.inputs = [];
    this.access.inputs.forEach(inp => {
      const on = prev[inp.id] !== undefined ? prev[inp.id] : true;
      this.inputs.push({ id: inp.id, name: inp.name || 'MIDI 入力',
                         manufacturer: inp.manufacturer || '', enabled: on });
      inp.onmidimessage = on ? (e => this.onMessage(e)) : null;
    });
  },

  setEnabled(id, on) {
    const rec = this.inputs.find(i => i.id === id);
    if (rec) rec.enabled = on;
    this.access.inputs.forEach(inp => {
      if (inp.id === id) inp.onmidimessage = on ? (e => this.onMessage(e)) : null;
    });
  },

  /* ── 受信ハンドラ (同期処理・最短経路) ── */
  onMessage(ev) {
    const t0 = performance.now();
    const d = ev.data;
    if (!d || d.length < 1) return;
    const status = d[0] & 0xF0;
    const ch = d[0] & 0x0F;
    if (this.channel && ch !== this.channel - 1) return;
    if (status === 0xF0) return;                      /* システム系は無視 */

    switch (status) {
      case 0x90:
        if (d[2] > 0) this.noteOn(d[1], d[2]);
        else this.noteOff(d[1]);
        break;
      case 0x80: this.noteOff(d[1]); break;
      case 0xB0: this.controlChange(d[1], d[2]); break;
      case 0xE0: this.pitchBend(((d[2] << 7) | d[1]) - 8192); break;
      case 0xD0: break;                               /* チャンネルアフタータッチ */
    }
    /* 処理時間の統計 (UI 表示用) */
    const dt = performance.now() - t0;
    this.stats.count++;
    this.stats.avgHandle = this.stats.avgHandle * 0.9 + dt * 0.1;
    this.lastEventMs = t0;
  },

  curve(v) {
    switch (this.velCurve) {
      case 'soft':  return U.clamp(Math.round(127 * Math.pow(v / 127, 0.65)), 1, 127);
      case 'hard':  return U.clamp(Math.round(127 * Math.pow(v / 127, 1.55)), 1, 127);
      case 'fixed': return this.fixedVel;
      default:      return v;
    }
  },

  targetTrack() {
    const p = Project.data;
    if (!p) return null;
    return p.tracks.find(t => t.armed && t.type !== 'audio') ||
           (Project.track(App.selectedTrackId) || {}).type !== 'audio' && Project.track(App.selectedTrackId) ||
           p.tracks.find(t => t.type !== 'audio') || null;
  },

  noteOn(note, vel) {
    const t = this.targetTrack();
    if (!t || !Engine.graph) return;
    const inst = Engine.graph.instruments[t.id];
    if (!inst) return;
    const pitch = U.clamp(note + this.transpose, 0, 127);
    /* ── 先読みゼロ: いま鳴らす ── */
    inst.noteOn(pitch, Engine.ctx.currentTime, this.curve(vel));
    this.activeNotes.set(note, { trackId: t.id, pitch, vel: this.curve(vel),
                                 startBeat: Transport.state === 'recording' ? Transport.nowInput() : null });
    if (App.onMidiActivity) App.onMidiActivity(pitch, this.curve(vel), true);
  },

  noteOff(note) {
    const rec = this.activeNotes.get(note);
    if (!rec) return;
    if (this.sustain) { this._sustained.add(note); return; }
    this.activeNotes.delete(note);
    const inst = Engine.graph && Engine.graph.instruments[rec.trackId];
    if (inst) inst.noteOff(rec.pitch, Engine.ctx.currentTime);
    if (rec.startBeat != null && Transport.state === 'recording') {
      App._recBuf.push({ pitch: rec.pitch, start: rec.startBeat,
                         length: Math.max(0.05, Transport.nowInput() - rec.startBeat), vel: rec.vel });
    }
    if (App.onMidiActivity) App.onMidiActivity(rec.pitch, 0, false);
  },

  controlChange(cc, val) {
    if (cc === 64) {                        /* サステインペダル */
      this.sustain = val >= 64;
      if (!this.sustain) {
        const list = Array.from(this._sustained);
        this._sustained.clear();
        list.forEach(n => this.noteOff(n));
      }
      return;
    }
    if (cc === 1) {                         /* モジュレーションホイール */
      this.modWheel = val / 127;
      const t = this.targetTrack();
      const inst = t && Engine.graph && Engine.graph.instruments[t.id];
      if (inst && inst.setModWheel) inst.setModWheel(this.modWheel);
      return;
    }
    if (cc === 7) {                         /* ボリューム */
      const t = this.targetTrack();
      if (t) { t.volume = U.faderToGain(val / 127); App.applyMix(); }
      return;
    }
    if (cc === 123 || cc === 120) this.panic();
  },

  pitchBend(raw) {
    this.bend = (raw / 8192) * this.bendRange;
    const t = this.targetTrack();
    const inst = t && Engine.graph && Engine.graph.instruments[t.id];
    if (inst && inst.setBend) inst.setBend(this.bend);
  },

  panic() {
    this.activeNotes.forEach((rec, n) => {
      const inst = Engine.graph && Engine.graph.instruments[rec.trackId];
      if (inst) inst.noteOff(rec.pitch, Engine.ctx.currentTime);
    });
    this.activeNotes.clear();
    this._sustained.clear();
    if (Engine.graph) Object.values(Engine.graph.instruments).forEach(i => i.allOff && i.allOff());
  }
};

/* ══════════════════════════════════════════════════════════════
   Latency — 実測レイテンシの取得と表示
   ══════════════════════════════════════════════════════════════ */
const Latency = {
  /* AudioContext が申告する出力レイテンシ (ms) */
  output() {
    const c = Engine.ctx;
    if (!c) return null;
    const base = (c.baseLatency || 0) * 1000;
    const outp = (c.outputLatency || 0) * 1000;
    return { base, output: outp, total: base + outp, sampleRate: c.sampleRate };
  },
  text() {
    const l = this.output();
    if (!l) return '—';
    return l.total.toFixed(1) + ' ms';
  },
  detail() {
    const l = this.output();
    if (!l) return 'オーディオエンジン未起動';
    const q = 128 / l.sampleRate * 1000;
    return [
      'サンプルレート: ' + Math.round(l.sampleRate) + ' Hz',
      'レンダー量子: 128 サンプル (' + q.toFixed(2) + ' ms)',
      'ベースレイテンシ: ' + l.base.toFixed(2) + ' ms',
      '出力レイテンシ: ' + l.output.toFixed(2) + ' ms',
      '合計 (発音→スピーカー): ' + l.total.toFixed(2) + ' ms',
      'MIDI 処理時間 (平均): ' + Midi.stats.avgHandle.toFixed(3) + ' ms'
    ].join('\n');
  }
};

window.Midi = Midi;
window.Latency = Latency;
