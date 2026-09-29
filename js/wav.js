/* ══════════════════════════════════════════════════════════════
   wav.js — オフラインレンダリング / WAV 書き出し / MIDI 書き出し
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── AudioBuffer → WAV (RIFF) ──
   bitDepth: 16 / 24 = 整数 PCM、32 = IEEE 32bit float
   サンプルレートは buffer.sampleRate をそのまま使う (最大 96 kHz) */
function encodeWav(buffer, bitDepth) {
  bitDepth = bitDepth || 24;
  const isFloat = (bitDepth === 32);
  const numCh = buffer.numberOfChannels;
  const len = buffer.length;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = len * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  let o = 0;
  const ws = s => { for (let i = 0; i < s.length; i++) dv.setUint8(o++, s.charCodeAt(i)); };
  const w32 = v => { dv.setUint32(o, v, true); o += 4; };
  const w16 = v => { dv.setUint16(o, v, true); o += 2; };

  ws('RIFF'); w32(36 + dataSize); ws('WAVE');
  ws('fmt '); w32(16); w16(isFloat ? 3 : 1); w16(numCh);
  w32(buffer.sampleRate); w32(buffer.sampleRate * blockAlign);
  w16(blockAlign); w16(bitDepth);
  ws('data'); w32(dataSize);

  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));

  if (isFloat) {                        /* 32bit float — 無劣化 */
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) { dv.setFloat32(o, chans[c][i], true); o += 4; }
    }
  } else if (bitDepth === 16) {
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        dv.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7FFF, true); o += 2;
      }
    }
  } else {                              /* 24bit */
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        const v = Math.round(s < 0 ? s * 0x800000 : s * 0x7FFFFF);
        dv.setUint8(o++, v & 0xFF); dv.setUint8(o++, (v >> 8) & 0xFF); dv.setUint8(o++, (v >> 16) & 0xFF);
      }
    }
  }
  return new Blob([ab], { type: 'audio/wav' });
}

/* ══════════════════ MP3 エンコード (lamejs / LGPL-MIT) ══════════════════
   MPEG-1 Layer III の規格上、対応サンプルレートは 32 / 44.1 / 48 kHz。
   88.2 / 96 kHz からは呼び出し側で 48 kHz にリサンプルしてから渡すこと。 */
const MP3_RATES = [32000, 44100, 48000];

function mp3Available() { return typeof window.lamejs === 'function' && !!window.lamejs.Mp3Encoder; }

function encodeMp3(buffer, kbps, onProgress) {
  if (!mp3Available()) throw new Error('MP3 エンコーダ (js/vendor/lame.min.js) が読み込まれていません');
  const rate = buffer.sampleRate;
  if (MP3_RATES.indexOf(rate) < 0) {
    throw new Error('MP3 は ' + MP3_RATES.map(r => r / 1000 + 'k').join(' / ') +
                    ' のみ対応です (現在 ' + (rate / 1000) + 'k)');
  }
  const numCh = Math.min(2, buffer.numberOfChannels);
  const enc = new window.lamejs.Mp3Encoder(numCh, rate, kbps || 320);
  const len = buffer.length;
  const L = buffer.getChannelData(0);
  const R = numCh > 1 ? buffer.getChannelData(1) : null;

  const BLOCK = 1152;
  const chunks = [];
  const li = new Int16Array(BLOCK);
  const ri = numCh > 1 ? new Int16Array(BLOCK) : null;

  for (let i = 0; i < len; i += BLOCK) {
    const n = Math.min(BLOCK, len - i);
    for (let j = 0; j < n; j++) {
      let v = L[i + j]; v = v < -1 ? -1 : v > 1 ? 1 : v;
      li[j] = v < 0 ? v * 0x8000 : v * 0x7FFF;
      if (ri) { let w = R[i + j]; w = w < -1 ? -1 : w > 1 ? 1 : w; ri[j] = w < 0 ? w * 0x8000 : w * 0x7FFF; }
    }
    const sl = n === BLOCK ? li : li.subarray(0, n);
    const sr = ri ? (n === BLOCK ? ri : ri.subarray(0, n)) : null;
    const buf = ri ? enc.encodeBuffer(sl, sr) : enc.encodeBuffer(sl);
    if (buf.length > 0) chunks.push(new Uint8Array(buf));
    if (onProgress && (i % (BLOCK * 200) === 0)) onProgress(i / len);
  }
  const end = enc.flush();
  if (end.length > 0) chunks.push(new Uint8Array(end));
  return new Blob(chunks, { type: 'audio/mpeg' });
}

const Bounce = {
  /* project 全体 (または範囲) をオフラインレンダリング */
  async render(project, opts) {
    opts = opts || {};
    const sr = opts.sampleRate || (Engine.ctx ? Engine.ctx.sampleRate : 48000);
    const spb = 60 / project.tempo;
    const startBeat = opts.startBeat || 0;
    const endBeat = opts.endBeat || Project.lengthBeats();
    const tail = opts.tail != null ? opts.tail : 3.0;
    const dur = Math.max(1, (endBeat - startBeat) * spb + tail);
    const frames = Math.ceil(dur * sr);

    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(2, frames, sr);
    const g = buildGraph(ctx, project, false);

    const soloActive = project.tracks.some(t => t.solo);
    const t0 = 0.02;
    project.tracks.forEach(t => {
      if (t.mute || (soloActive && !t.solo)) return;
      const inst = g.instruments[t.id];
      if (!inst && t.type !== 'audio') return;
      t.regions.forEach(r => {
        if (r.mute) return;
        const reps = 1 + (r.loop || 0);
        for (let k = 0; k < reps; k++) {
          const ofs = r.start + k * r.length;

          /* ── オーディオリージョン ── */
          if (r.type === 'audio') {
            const buf = AudioPool.buffer(r.audioId);
            if (!buf) continue;
            const regEnd = ofs + r.length;
            if (regEnd <= startBeat || ofs >= endBeat) continue;
            const chIn = g.channels[t.id].input;
            scheduleAudioRegion(ctx, chIn, r, buf, ofs, t0, startBeat, spb,
                                Math.max(startBeat, ofs), Math.min(endBeat, regEnd));
            continue;
          }

          /* ── MIDI リージョン ── */
          r.notes.forEach(n => {
            const abs = ofs + n.start;
            if (abs < startBeat || abs >= endBeat) return;
            const time = t0 + (abs - startBeat) * spb;
            const vel = U.clamp(Math.round(n.vel * (r.velocityScale || 1)), 1, 127);
            const pitch = U.clamp(n.pitch + (r.transpose || 0), 0, 127);
            inst.noteOn(pitch, time, vel, n.length * spb);
          });
        }
      });
    });

    if (opts.metronome) {
      for (let b = Math.ceil(startBeat); b < endBeat; b++) {
        const time = t0 + (b - startBeat) * spb;
        const o = ctx.createOscillator(), gn = ctx.createGain();
        o.type = 'square';
        o.frequency.value = (b % project.sigNum === 0) ? 1600 : 1050;
        gn.gain.setValueAtTime(0, time);
        gn.gain.linearRampToValueAtTime(0.25, time + 0.001);
        gn.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
        o.connect(gn); gn.connect(g.masterVol);
        o.start(time); o.stop(time + 0.06);
      }
    }

    return await ctx.startRendering();
  }
};

/* ══════════════════ MIDI 書き出し (SMF Format 1) ══════════════════ */
const MidiExport = {
  PPQ: 480,

  vlq(n) {
    const out = [];
    let buf = n & 0x7F;
    while ((n >>= 7)) { buf <<= 8; buf |= ((n & 0x7F) | 0x80); }
    for (;;) { out.push(buf & 0xFF); if (buf & 0x80) buf >>= 8; else break; }
    return out;
  },
  str(s) { return Array.from(s).map(c => c.charCodeAt(0)); },
  chunk(id, data) {
    const len = data.length;
    return [].concat(this.str(id), [(len >> 24) & 255, (len >> 16) & 255, (len >> 8) & 255, len & 255], data);
  },

  build(project) {
    const tracks = [];
    /* テンポトラック */
    const usPerBeat = Math.round(60000000 / project.tempo);
    let tempoTrk = [].concat(
      [0, 0xFF, 0x51, 0x03, (usPerBeat >> 16) & 255, (usPerBeat >> 8) & 255, usPerBeat & 255],
      [0, 0xFF, 0x58, 0x04, project.sigNum, Math.round(Math.log2(project.sigDen)), 24, 8],
      this.vlq(0), [0xFF, 0x03], [Math.min(127, project.name.length)], this.str(project.name).slice(0, 127),
      [0, 0xFF, 0x2F, 0x00]
    );
    tracks.push(this.chunk('MTrk', tempoTrk));

    project.tracks.forEach((t, ti) => {
      const evs = [];
      const ch = Math.min(15, Instruments.isDrum(t.instrument) ? 9 : ti % 15);
      t.regions.forEach(r => {
        if (r.mute) return;
        const reps = 1 + (r.loop || 0);
        for (let k = 0; k < reps; k++) {
          const ofs = r.start + k * r.length;
          r.notes.forEach(n => {
            const st = Math.round((ofs + n.start) * this.PPQ);
            const en = Math.round((ofs + n.start + n.length) * this.PPQ);
            const p = U.clamp(n.pitch + (r.transpose || 0), 0, 127);
            const v = U.clamp(Math.round(n.vel * (r.velocityScale || 1)), 1, 127);
            evs.push({ tick: st, d: [0x90 | ch, p, v] });
            evs.push({ tick: Math.max(en, st + 1), d: [0x80 | ch, p, 0] });
          });
        }
      });
      evs.sort((a, b) => a.tick - b.tick || (a.d[0] & 0xF0) - (b.d[0] & 0xF0));
      let data = [].concat(this.vlq(0), [0xFF, 0x03], [Math.min(127, t.name.length)], this.str(t.name).slice(0, 127));
      let last = 0;
      evs.forEach(e => { data = data.concat(this.vlq(e.tick - last), e.d); last = e.tick; });
      data = data.concat([0, 0xFF, 0x2F, 0x00]);
      tracks.push(this.chunk('MTrk', data));
    });

    const header = this.chunk('MThd', [0, 1, (tracks.length >> 8) & 255, tracks.length & 255,
                                       (this.PPQ >> 8) & 255, this.PPQ & 255]);
    let all = header;
    tracks.forEach(t => all = all.concat(t));
    return new Blob([new Uint8Array(all)], { type: 'audio/midi' });
  }
};

window.encodeWav = encodeWav;
window.Bounce = Bounce;
window.MidiExport = MidiExport;
