/* ══════════════════════════════════════════════════════════════
   transport.js — 再生 / 録音 / ルックアヘッドスケジューラ
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Transport = {
  state: 'stopped',            // stopped | playing | recording
  positionBeats: 0,            // 停止中の再生ヘッド位置
  _timer: null,
  _schedBeat: 0,
  _schedTime: 0,
  _segments: [],
  _audioSrcs: [],          /* 発音中のオーディオリージョン */
  _seekPoint: true,        /* 直後のチャンクがシーク/ループ折返し直後か */
  _lastClickBeat: -1,
  _countInUntil: 0,
  LOOKAHEAD: 0.16,             // 秒
  CHUNK: 0.125,                // 拍

  get p() { return Project.data; },
  get spb() { return 60 / Project.data.tempo; },

  isPlaying() { return this.state === 'playing' || this.state === 'recording'; },

  /* ── 録音レイテンシ補正 ──
     スピーカーから音が出るのは ctx.currentTime より outputLatency ぶん後。
     演奏者は「聞こえた音」に合わせて弾くため、そのまま記録すると
     出力レイテンシぶん遅れて記録されてしまう。差し引いて補正する。 */
  inputOffsetBeats() {
    const p = Project.data;
    if (!p || p.latencyComp === false) return 0;
    const c = Engine.ctx;
    if (!c) return 0;
    const sec = (c.outputLatency || 0) + (c.baseLatency || 0);
    return sec * p.tempo / 60;
  },
  /* 演奏入力を記録するときの位置 (補正済み) */
  nowInput() { return Math.max(0, this.now() - this.inputOffsetBeats()); },

  /* ── 再生位置 (拍) ── */
  now() {
    if (!this.isPlaying()) return this.positionBeats;
    const t = Engine.ctx.currentTime;
    const segs = this._segments;
    if (!segs.length) return this.positionBeats;
    if (t <= segs[0].t0) return segs[0].b0;
    for (let i = segs.length - 1; i >= 0; i--) {
      const s = segs[i];
      if (t >= s.t0 && t < s.t1) return s.b0 + (t - s.t0) / this.spb;
    }
    const last = segs[segs.length - 1];
    return last.b1;
  },

  /* ── 開始 ── */
  async play(record) {
    if (!(await Engine.resume())) { U.toast('オーディオを起動できませんでした'); return; }
    if (this.isPlaying()) { if (!record) return; this.stop(); }

    const p = this.p;
    this.state = record ? 'recording' : 'playing';
    let startBeat = this.positionBeats;
    if (p.cycle.on && (startBeat < p.cycle.start || startBeat >= p.cycle.end)) startBeat = p.cycle.start;

    const t0 = Engine.ctx.currentTime + 0.08;
    this._schedBeat = startBeat;
    this._schedTime = t0;
    this._segments = [];
    this._lastClickBeat = Math.floor(startBeat) - 1;
    this._countInUntil = 0;
    this._seekPoint = true;
    this._stopAudioSources();

    /* カウントイン */
    if (record && p.countIn) {
      const bars = 1, beats = bars * p.sigNum;
      for (let i = 0; i < beats; i++) {
        Engine.click(t0 + i * this.spb, i % p.sigNum === 0);
      }
      const off = beats * this.spb;
      this._schedTime = t0 + off;
      this._countInUntil = t0 + off;
    }

    this._timer = setInterval(() => this._tick(), 20);
    this._tick();
    App.onTransportChange();
  },

  /* ── 停止 ── */
  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.isPlaying()) this.positionBeats = Math.max(0, this.now());
    if (this.state === 'recording') App.finalizeRecording();
    this.state = 'stopped';
    this._segments = [];
    this._stopAudioSources();
    if (Engine.graph) Object.values(Engine.graph.instruments).forEach(i => i && i.allOff && i.allOff());
    App.onTransportChange();
  },

  /* 停止 → もう一度押すと先頭へ */
  stopOrReturn() {
    if (this.isPlaying()) this.stop();
    else this.locate(this.p.cycle.on ? this.p.cycle.start : 0);
  },

  toggle() { if (this.isPlaying()) this.stop(); else this.play(false); },

  locate(beat) {
    beat = Math.max(0, beat);
    const wasPlaying = this.isPlaying();
    const wasRec = this.state === 'recording';
    if (wasPlaying) this.stop();
    this.positionBeats = beat;
    App.onPositionChange();
    if (wasPlaying) this.play(wasRec);
  },

  nudgeBars(n) {
    const s = this.p.sigNum;
    let b = (this.isPlaying() ? this.now() : this.positionBeats);
    b = Math.round(b / s) * s + n * s;
    this.locate(Math.max(0, b));
  },

  _stopAudioSources() {
    this._audioSrcs.forEach(a => {
      try { a.gain.gain.cancelScheduledValues(Engine.ctx.currentTime); } catch (e) {}
      try { a.gain.gain.setTargetAtTime(0, Engine.ctx.currentTime, 0.004); } catch (e) {}
      try { a.src.stop(Engine.ctx.currentTime + 0.03); } catch (e) {}
    });
    this._audioSrcs = [];
  },

  /* ── スケジューラ本体 ── */
  _tick() {
    if (!this.isPlaying() || !Engine.graph) return;
    const ctx = Engine.ctx;
    const horizon = ctx.currentTime + this.LOOKAHEAD;
    const p = this.p, spb = this.spb;
    let guard = 0;

    while (this._schedTime < horizon && guard++ < 400) {
      let b0 = this._schedBeat;
      let b1 = b0 + this.CHUNK;
      let wrap = false;
      if (p.cycle.on && b0 < p.cycle.end && b1 >= p.cycle.end) { b1 = p.cycle.end; wrap = true; }

      this._scheduleRange(b0, b1, this._schedTime, this._seekPoint);
      if (this._seekPoint && !wrap) this._seekPoint = false;

      /* セグメント記録 (位置表示用) */
      const segs = this._segments;
      const last = segs[segs.length - 1];
      const dur = (b1 - b0) * spb;
      if (last && Math.abs(last.b1 - b0) < 1e-9 && Math.abs(last.t1 - this._schedTime) < 1e-6) {
        last.b1 = b1; last.t1 = this._schedTime + dur;
      } else {
        segs.push({ b0, b1, t0: this._schedTime, t1: this._schedTime + dur });
      }
      while (segs.length > 2 && segs[1].t1 < ctx.currentTime - 0.5) segs.shift();

      this._schedTime += dur;
      this._seekPoint = wrap;
      this._schedBeat = wrap ? p.cycle.start : b1;

      /* 停止条件: サイクルオフでプロジェクト終端 */
      if (!p.cycle.on && this._schedBeat > Project.lengthBeats()) { setTimeout(() => this.stop(), 400); break; }
    }
  },

  _scheduleRange(b0, b1, tAt, seekPoint) {
    const p = this.p, spb = this.spb;
    const timeOf = beat => tAt + (beat - b0) * spb;

    /* メトロノーム */
    if (p.metronome) {
      const first = Math.ceil(b0 - 1e-9);
      for (let b = first; b < b1; b++) {
        Engine.click(timeOf(b), ((b % p.sigNum) + p.sigNum) % p.sigNum === 0);
      }
    }

    const soloActive = p.tracks.some(t => t.solo);
    for (const t of p.tracks) {
      if (t.mute || (soloActive && !t.solo)) continue;
      const inst = Engine.graph.instruments[t.id];
      if (!inst && t.type !== 'audio') continue;
      /* 録音中の対象トラックはライブ入力優先 (二重再生を防がない: 既存リージョンは鳴らす) */
      for (const r of t.regions) {
        if (r.mute) continue;
        const reps = 1 + (r.loop || 0);
        for (let k = 0; k < reps; k++) {
          const ofs = r.start + k * r.length;
          if (ofs >= b1 || ofs + r.length <= b0) continue;

          /* ── オーディオリージョン ── */
          if (r.type === 'audio') {
            const startsHere = ofs >= b0 && ofs < b1;
            const spansSeek = seekPoint && ofs < b0 && ofs + r.length > b0;
            if (!startsHere && !spansSeek) continue;
            const buf = AudioPool.buffer(r.audioId);
            if (!buf) continue;
            const from = Math.max(ofs, b0);
            const to = ofs + r.length;
            const h = scheduleAudioRegion(Engine.ctx, Engine.channel(t.id).input,
                                          r, buf, ofs, tAt, b0, spb, from, to);
            if (h) {
              this._audioSrcs.push(h);
              if (this._audioSrcs.length > 96) this._audioSrcs.shift();
            }
            continue;
          }

          const lo = b0 - ofs, hi = b1 - ofs;
          for (const n of r.notes) {
            if (n.start >= lo && n.start < hi) {
              const abs = ofs + n.start;
              const vel = U.clamp(Math.round(n.vel * (r.velocityScale || 1)), 1, 127);
              const pitch = U.clamp(n.pitch + (r.transpose || 0), 0, 127);
              inst.noteOn(pitch, timeOf(abs), vel, n.length * spb);
            }
          }
        }
      }
    }
  }
};

window.Transport = Transport;
