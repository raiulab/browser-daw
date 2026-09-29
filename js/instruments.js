/* ══════════════════════════════════════════════════════════════
   instruments.js — ソフトウェア音源
     ・PolySynth  : 2OSC + ノイズ + フィルタ + 2ENV + LFO の減算合成
     ・FMPiano    : FM 方式のピアノ / エレピ / ベル
     ・DrumKit    : 合成ドラム音源 (Drum Machine Designer 相当)
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ────────── パラメータ既定値 ────────── */
const SYNTH_DEFAULTS = {
  osc1: { wave: 'sawtooth', oct: 0, semi: 0, detune: 0, level: 0.8 },
  osc2: { wave: 'sawtooth', oct: 0, semi: 0, detune: 9, level: 0.55 },
  noise: 0.0,
  unison: 1, spread: 12,
  filter: { type: 'lowpass', cutoff: 3200, q: 6, env: 2600, keytrack: 0.35 },
  fenv: { a: 0.004, d: 0.30, s: 0.35, r: 0.30 },
  aenv: { a: 0.006, d: 0.22, s: 0.72, r: 0.32 },
  lfo:  { rate: 5.2, pitch: 0, filter: 0, amp: 0 },
  drive: 0.0, glide: 0, level: 0.5, pbRange: 2
};
const DRUM_DEFAULTS = {
  level: 0.85, tune: 0, snap: 0.5, decay: 1.0,
  gains: { kick: 1, snare: 0.9, clap: 0.75, hhc: 0.5, hho: 0.5, rim: 0.6,
           tomL: 0.8, tomM: 0.8, tomH: 0.8, crash: 0.5, ride: 0.5, cow: 0.5 }
};
const FM_DEFAULTS = {
  ratio: 3.0, index: 3.2, indexDecay: 0.55,
  aenv: { a: 0.002, d: 1.6, s: 0.0, r: 0.5 },
  detune: 0, level: 0.6, stereo: 0.25, tone: 8000
};

function deepMerge(base, ov) {
  const o = JSON.parse(JSON.stringify(base));
  if (!ov) return o;
  for (const k in ov) {
    if (ov[k] && typeof ov[k] === 'object' && !Array.isArray(ov[k]) && o[k] && typeof o[k] === 'object')
      o[k] = deepMerge(o[k], ov[k]);
    else o[k] = ov[k];
  }
  return o;
}

/* ドライブ用ウェーブシェイパーカーブ */
function driveCurve(amount) {
  const n = 1024, c = new Float32Array(n);
  const k = amount * 60;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (1 + k) * x / (1 + k * Math.abs(x));
  }
  return c;
}

/* ══════════════════ PolySynth ══════════════════ */
function PolySynth(ctx, def, dest) {
  const P = deepMerge(SYNTH_DEFAULTS, def.params);
  const self = { type: 'synth', params: P, def };

  const out = ctx.createGain();
  out.gain.value = P.level;
  let shaper = null;
  if (P.drive > 0.001) {
    shaper = ctx.createWaveShaper();
    shaper.curve = driveCurve(P.drive);
    shaper.oversample = '2x';
    out.connect(shaper); shaper.connect(dest);
  } else {
    out.connect(dest);
  }

  /* グローバル LFO */
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.value = P.lfo.rate;
  const lfoPitch  = ctx.createGain(); lfoPitch.gain.value  = P.lfo.pitch;   // cents
  const lfoFilter = ctx.createGain(); lfoFilter.gain.value = P.lfo.filter;  // Hz
  lfo.connect(lfoPitch); lfo.connect(lfoFilter);
  try { lfo.start(); } catch (e) {}

  const active = new Map();   // key -> voice[]
  const liveVoices = [];      // ピッチベンド適用対象
  let bendCents = 0;

  function makeVoice(midi, time, vel) {
    const v = { nodes: [], endTime: 0 };
    const freq = U.midiToFreq(midi);
    const velG = Math.pow(vel / 127, 1.35);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);

    const filt = ctx.createBiquadFilter();
    filt.type = P.filter.type;
    filt.Q.value = U.clamp(P.filter.q, 0.0001, 24);
    const keyHz = P.filter.cutoff * Math.pow(2, ((midi - 60) / 12) * P.filter.keytrack);
    const base  = U.clamp(keyHz, 30, 18000);
    filt.frequency.setValueAtTime(base, time);
    lfoFilter.connect(filt.frequency);

    /* フィルタエンベロープ */
    const fe = P.fenv, envAmt = P.filter.env;
    if (Math.abs(envAmt) > 1) {
      const peak = U.clamp(base + envAmt, 30, 19000);
      const sus  = U.clamp(base + envAmt * fe.s, 30, 19000);
      filt.frequency.linearRampToValueAtTime(peak, time + Math.max(0.001, fe.a));
      filt.frequency.setTargetAtTime(sus, time + Math.max(0.001, fe.a), Math.max(0.008, fe.d / 3));
    }

    /* アンプエンベロープ (アタック→ディケイ→サステイン) */
    const ae = P.aenv;
    const peakG = velG;
    amp.gain.linearRampToValueAtTime(peakG, time + Math.max(0.0008, ae.a));
    amp.gain.setTargetAtTime(Math.max(0.0001, peakG * ae.s),
                             time + Math.max(0.0008, ae.a), Math.max(0.008, ae.d / 3));

    filt.connect(amp);
    amp.connect(out);
    v.amp = amp; v.filt = filt;

    /* オシレータ生成 */
    const uni = U.clamp(P.unison | 0, 1, 5);
    const oscs = [];
    [P.osc1, P.osc2].forEach(od => {
      if (od.level <= 0.001) return;
      for (let u = 0; u < uni; u++) {
        const o = ctx.createOscillator();
        o.type = od.wave === 'noise' ? 'sawtooth' : od.wave;
        const semis = od.oct * 12 + od.semi;
        o.frequency.setValueAtTime(freq * Math.pow(2, semis / 12), time);
        const spread = uni > 1 ? ((u - (uni - 1) / 2) * P.spread) : 0;
        const baseDet = od.detune + spread;
        o.detune.setValueAtTime(baseDet + bendCents, time);
        o.__base = baseDet;
        lfoPitch.connect(o.detune);
        const g = ctx.createGain();
        g.gain.value = (od.level / uni) * 0.5;
        o.connect(g); g.connect(filt);
        o.start(time);
        oscs.push({ o, g });
      }
    });

    /* ノイズ */
    let noiseSrc = null;
    if (P.noise > 0.001) {
      noiseSrc = ctx.createBufferSource();
      noiseSrc.buffer = noiseBuffer(ctx);
      noiseSrc.loop = true;
      const ng = ctx.createGain(); ng.gain.value = P.noise * 0.35;
      noiseSrc.connect(ng); ng.connect(filt);
      noiseSrc.start(time);
    }

    v.oscs = oscs; v.noise = noiseSrc; v.midi = midi; v.startTime = time;
    liveVoices.push(v);
    return v;
  }

  function releaseVoice(v, time) {
    const ae = P.aenv, fe = P.fenv;
    const rel = Math.max(0.012, ae.r);
    try {
      v.amp.gain.cancelScheduledValues(time);
      const cur = Math.max(0.0001, v.amp.gain.value);
      v.amp.gain.setValueAtTime(cur, time);
      v.amp.gain.setTargetAtTime(0.0001, time, rel / 3.2);
      if (Math.abs(P.filter.env) > 1) {
        v.filt.frequency.cancelScheduledValues(time);
        v.filt.frequency.setTargetAtTime(
          U.clamp(P.filter.cutoff, 30, 19000), time, Math.max(0.01, fe.r / 3));
      }
    } catch (e) {}
    const stopAt = time + rel * 1.6 + 0.06;
    v.endTime = stopAt;
    v.oscs.forEach(x => { try { x.o.stop(stopAt); } catch (e) {} });
    if (v.noise) { try { v.noise.stop(stopAt); } catch (e) {} }
    const li = liveVoices.indexOf(v); if (li >= 0) liveVoices.splice(li, 1);
    setTimeout(() => {
      try { lfoFilter.disconnect(v.filt.frequency); } catch (e) {}
      v.oscs.forEach(x => { try { lfoPitch.disconnect(x.o.detune); } catch (e) {} });
      try { v.amp.disconnect(); v.filt.disconnect(); } catch (e) {}
    }, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 260);
  }

  self.noteOn = function (midi, time, vel, dur) {
    time = Math.max(time, ctx.currentTime);
    const v = makeVoice(midi, time, vel == null ? 100 : vel);
    if (dur != null) {
      releaseVoice(v, time + Math.max(0.02, dur));
    } else {
      const arr = active.get(midi) || [];
      arr.push(v); active.set(midi, arr);
    }
    return v;
  };
  self.noteOff = function (midi, time) {
    const arr = active.get(midi);
    if (!arr || !arr.length) return;
    const v = arr.shift();
    if (!arr.length) active.delete(midi);
    releaseVoice(v, Math.max(time || ctx.currentTime, ctx.currentTime));
  };
  self.allOff = function () {
    const t = ctx.currentTime;
    active.forEach(arr => arr.forEach(v => releaseVoice(v, t)));
    active.clear();
  };
  self.dispose = function () {
    self.allOff();
    try { lfo.stop(); } catch (e) {}
    try { out.disconnect(); if (shaper) shaper.disconnect(); } catch (e) {}
  };
  self.setLevel = function (l) { out.gain.value = l; };
  self.setBend = function (semi) {
    bendCents = semi * 100;
    const t = ctx.currentTime;
    liveVoices.forEach(v => v.oscs.forEach(x => {
      if (x.o.__base == null) return;
      try { x.o.detune.setTargetAtTime(x.o.__base + bendCents, t, 0.005); } catch (e) {}
    }));
  };
  return self;
}

/* ══════════════════ FM ピアノ / エレピ / ベル ══════════════════ */
function FMSynth(ctx, def, dest) {
  const P = deepMerge(FM_DEFAULTS, def.params);
  const self = { type: 'fm', params: P, def };
  const out = ctx.createGain(); out.gain.value = P.level;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass';
  tone.frequency.value = P.tone;
  out.connect(tone); tone.connect(dest);

  const active = new Map();

  function makeVoice(midi, time, vel) {
    const f = U.midiToFreq(midi);
    const velG = Math.pow(vel / 127, 1.5);
    const ae = P.aenv;

    const carrier = ctx.createOscillator(); carrier.type = 'sine';
    carrier.frequency.setValueAtTime(f, time);
    carrier.detune.value = P.detune;

    const mod = ctx.createOscillator(); mod.type = 'sine';
    mod.frequency.setValueAtTime(f * P.ratio, time);
    const modGain = ctx.createGain();
    const idx = P.index * f * velG;
    modGain.gain.setValueAtTime(idx, time);
    modGain.gain.setTargetAtTime(idx * 0.04, time, Math.max(0.02, P.indexDecay));
    mod.connect(modGain); modGain.connect(carrier.frequency);

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(velG, time + Math.max(0.001, ae.a));
    amp.gain.setTargetAtTime(Math.max(0.0001, velG * ae.s),
                             time + Math.max(0.001, ae.a), Math.max(0.02, ae.d / 3));

    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) { pan.pan.value = U.clamp(((midi - 60) / 30) * P.stereo, -1, 1); amp.connect(pan); pan.connect(out); }
    else amp.connect(out);

    carrier.connect(amp);
    carrier.start(time); mod.start(time);
    return { carrier, mod, modGain, amp, midi };
  }
  function release(v, time) {
    const r = Math.max(0.02, P.aenv.r);
    try {
      v.amp.gain.cancelScheduledValues(time);
      v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), time);
      v.amp.gain.setTargetAtTime(0.0001, time, r / 3.2);
    } catch (e) {}
    const st = time + r * 1.8 + 0.08;
    try { v.carrier.stop(st); v.mod.stop(st); } catch (e) {}
    setTimeout(() => { try { v.amp.disconnect(); v.modGain.disconnect(); } catch (e) {} },
      Math.max(0, (st - ctx.currentTime) * 1000) + 250);
  }
  self.noteOn = function (midi, time, vel, dur) {
    time = Math.max(time, ctx.currentTime);
    const v = makeVoice(midi, time, vel == null ? 100 : vel);
    if (dur != null) release(v, time + Math.max(0.02, dur));
    else { const a = active.get(midi) || []; a.push(v); active.set(midi, a); }
    return v;
  };
  self.noteOff = function (midi, time) {
    const a = active.get(midi); if (!a || !a.length) return;
    const v = a.shift(); if (!a.length) active.delete(midi);
    release(v, Math.max(time || ctx.currentTime, ctx.currentTime));
  };
  self.allOff = function () { const t = ctx.currentTime; active.forEach(a => a.forEach(v => release(v, t))); active.clear(); };
  self.dispose = function () { self.allOff(); try { out.disconnect(); tone.disconnect(); } catch (e) {} };
  self.setLevel = l => { out.gain.value = l; };
  return self;
}

/* ══════════════════ ドラムキット ══════════════════ */
const DRUM_MAP = [
  { midi: 36, name: 'Kick',        key: 'kick'  },
  { midi: 37, name: 'Rim',         key: 'rim'   },
  { midi: 38, name: 'Snare',       key: 'snare' },
  { midi: 39, name: 'Clap',        key: 'clap'  },
  { midi: 41, name: 'Tom Low',     key: 'tomL'  },
  { midi: 42, name: 'HiHat Closed',key: 'hhc'   },
  { midi: 45, name: 'Tom Mid',     key: 'tomM'  },
  { midi: 46, name: 'HiHat Open',  key: 'hho'   },
  { midi: 48, name: 'Tom High',    key: 'tomH'  },
  { midi: 49, name: 'Crash',       key: 'crash' },
  { midi: 51, name: 'Ride',        key: 'ride'  },
  { midi: 56, name: 'Cowbell',     key: 'cow'   }
];

function DrumKit(ctx, def, dest) {
  const P = deepMerge(DRUM_DEFAULTS, def.params);
  const self = { type: 'drums', params: P, def, drumMap: DRUM_MAP };

  const out = ctx.createGain(); out.gain.value = P.level;
  out.connect(dest);
  let hhoNode = null;   // オープンハイハットのチョーク用

  const tuneMul = Math.pow(2, P.tune / 12);
  const dec = P.decay;

  function env(g, t, peak, decay, hold) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.001);
    if (hold) g.gain.setValueAtTime(peak, t + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.02, decay));
  }
  function noise(t, dur, filterType, freq, q) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuffer(ctx);
    s.loop = true;
    s.playbackRate.value = 1 + Math.random() * 0.06;
    const f = ctx.createBiquadFilter();
    f.type = filterType; f.frequency.value = freq; f.Q.value = q || 1;
    s.connect(f);
    s.start(t + Math.random() * 0.002);
    s.stop(t + dur + 0.05);
    return f;
  }

  const voices = {
    kick(t, v) {
      const o = ctx.createOscillator(); o.type = 'sine';
      const g = ctx.createGain();
      const f0 = 132 * tuneMul, f1 = 44 * tuneMul;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.055);
      o.frequency.exponentialRampToValueAtTime(f1 * 0.82, t + 0.42 * dec);
      env(g, t, v * 1.0, 0.46 * dec);
      const sh = ctx.createWaveShaper(); sh.curve = driveCurve(0.32);
      o.connect(sh); sh.connect(g); g.connect(bus('kick'));
      o.start(t); o.stop(t + 0.7 * dec);
      /* クリック */
      const c = ctx.createOscillator(); c.type = 'triangle'; c.frequency.setValueAtTime(1900, t);
      const cg = ctx.createGain(); env(cg, t, v * 0.30 * P.snap, 0.016);
      c.connect(cg); cg.connect(bus('kick')); c.start(t); c.stop(t + 0.04);
    },
    snare(t, v) {
      const f = noise(t, 0.24 * dec, 'highpass', 1500 + P.snap * 900, 0.8);
      const g = ctx.createGain(); env(g, t, v * 0.65, 0.19 * dec);
      f.connect(g); g.connect(bus('snare'));
      [196, 278].forEach((fr, i) => {
        const o = ctx.createOscillator(); o.type = 'triangle';
        o.frequency.setValueAtTime(fr * tuneMul, t);
        o.frequency.exponentialRampToValueAtTime(fr * 0.72 * tuneMul, t + 0.09);
        const og = ctx.createGain(); env(og, t, v * (i ? 0.22 : 0.38), 0.11 * dec);
        o.connect(og); og.connect(bus('snare')); o.start(t); o.stop(t + 0.22 * dec);
      });
    },
    clap(t, v) {
      for (let i = 0; i < 4; i++) {
        const dt = i * 0.011;
        const f = noise(t + dt, 0.14, 'bandpass', 1250, 1.7);
        const g = ctx.createGain();
        env(g, t + dt, v * (i === 3 ? 0.55 : 0.30), i === 3 ? 0.19 * dec : 0.028);
        f.connect(g); g.connect(bus('clap'));
      }
    },
    rim(t, v) {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(1720 * tuneMul, t);
      const g = ctx.createGain(); env(g, t, v * 0.4, 0.038);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1700; bp.Q.value = 5;
      o.connect(bp); bp.connect(g); g.connect(bus('rim')); o.start(t); o.stop(t + 0.06);
    },
    hhc(t, v) { hat(t, v, 0.055 * dec, 'hhc'); },
    hho(t, v) { hhoNode = hat(t, v, 0.42 * dec, 'hho'); },
    tomL(t, v) { tom(t, v, 108); }, tomM(t, v) { tom(t, v, 158); }, tomH(t, v) { tom(t, v, 215); },
    crash(t, v) { cymbal(t, v, 1.9 * dec, 'crash', 320); },
    ride(t, v)  { cymbal(t, v, 1.3 * dec, 'ride', 520); },
    cow(t, v) {
      [540, 810].forEach((fr, i) => {
        const o = ctx.createOscillator(); o.type = 'square';
        o.frequency.setValueAtTime(fr * tuneMul, t);
        const g = ctx.createGain(); env(g, t, v * (i ? 0.22 : 0.3), 0.28 * dec);
        o.connect(g); g.connect(bus('cow')); o.start(t); o.stop(t + 0.34 * dec);
      });
    }
  };
  function tom(t, v, base) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(base * tuneMul, t);
    o.frequency.exponentialRampToValueAtTime(base * 0.62 * tuneMul, t + 0.3 * dec);
    const g = ctx.createGain(); env(g, t, v * 0.75, 0.34 * dec);
    o.connect(g); g.connect(bus(base < 120 ? 'tomL' : base < 180 ? 'tomM' : 'tomH'));
    o.start(t); o.stop(t + 0.5 * dec);
    const f = noise(t, 0.06, 'highpass', 2600, 1);
    const ng = ctx.createGain(); env(ng, t, v * 0.12, 0.05);
    f.connect(ng); ng.connect(bus('tomM'));
  }
  function hat(t, v, decay, key) {
    /* 6本の矩形波 → バンドパス (808 方式) */
    const mix = ctx.createGain();
    [263, 400, 421, 474, 587, 845].forEach(fr => {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(fr * tuneMul, t);
      o.connect(mix); o.start(t); o.stop(t + decay + 0.06);
    });
    mix.gain.value = 0.12;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7200;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 10500; bp.Q.value = 1.1;
    const g = ctx.createGain(); env(g, t, v * 0.5, decay);
    mix.connect(hp); hp.connect(bp); bp.connect(g); g.connect(bus(key));
    return g;
  }
  function cymbal(t, v, decay, key, hpf) {
    const mix = ctx.createGain(); mix.gain.value = 0.08;
    [263, 400, 421, 474, 587, 845, 1100].forEach(fr => {
      const o = ctx.createOscillator(); o.type = 'square';
      o.frequency.setValueAtTime(fr * 1.34 * tuneMul, t);
      o.connect(mix); o.start(t); o.stop(t + decay + 0.1);
    });
    const n = noise(t, decay, 'highpass', hpf * 3, 0.7);
    const ng = ctx.createGain(); ng.gain.value = 0.3; n.connect(ng); ng.connect(mix);
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = hpf;
    const g = ctx.createGain(); env(g, t, v * 0.42, decay);
    mix.connect(hp); hp.connect(g); g.connect(bus(key));
  }

  const busCache = {};
  function bus(key) {
    if (busCache[key]) return busCache[key];
    const g = ctx.createGain();
    g.gain.value = (P.gains[key] != null ? P.gains[key] : 0.8);
    g.connect(out);
    busCache[key] = g;
    return g;
  }

  self.noteOn = function (midi, time, vel) {
    time = Math.max(time, ctx.currentTime);
    const m = DRUM_MAP.find(d => d.midi === midi) || DRUM_MAP.find(d => d.midi === 36 + ((midi - 36) % 12 + 12) % 12);
    if (!m) return;
    const v = Math.pow((vel == null ? 100 : vel) / 127, 1.2);
    if (m.key === 'hhc' && hhoNode) {           // クローズドでオープンをチョーク
      try { hhoNode.gain.cancelScheduledValues(time);
            hhoNode.gain.setTargetAtTime(0.0001, time, 0.008); } catch (e) {}
      hhoNode = null;
    }
    try { voices[m.key](time, v); } catch (e) {}
  };
  self.noteOff = function () {};
  self.allOff  = function () {};
  self.dispose = function () { try { out.disconnect(); } catch (e) {} };
  self.setLevel = l => { out.gain.value = l; };
  return self;
}

/* ══════════════════ プリセット ══════════════════ */
const PRESETS = {
  /* — シンセ / キーボード — */
  'Classic Lead':   { engine: 'synth', params: { osc1:{wave:'sawtooth',level:.8}, osc2:{wave:'square',detune:11,level:.5},
                      filter:{cutoff:1500,q:9,env:4200,keytrack:.4}, fenv:{a:.004,d:.28,s:.25,r:.25},
                      aenv:{a:.005,d:.2,s:.8,r:.25}, drive:.22, level:.42 } },
  'Fat Saw Bass':   { engine: 'synth', params: { osc1:{wave:'sawtooth',oct:-1,level:.9}, osc2:{wave:'square',oct:-1,detune:-7,level:.5},
                      unison:2, spread:8, filter:{cutoff:520,q:7,env:1900,keytrack:.28},
                      fenv:{a:.002,d:.16,s:.14,r:.14}, aenv:{a:.003,d:.14,s:.85,r:.12}, drive:.35, level:.5 } },
  'Sub Bass':       { engine: 'synth', params: { osc1:{wave:'sine',oct:-1,level:1}, osc2:{level:0},
                      filter:{cutoff:900,q:1,env:200,keytrack:.2}, aenv:{a:.006,d:.2,s:.9,r:.18}, level:.62 } },
  'Warm Pad':       { engine: 'synth', params: { osc1:{wave:'sawtooth',level:.6}, osc2:{wave:'sawtooth',detune:-14,level:.6},
                      unison:3, spread:16, noise:.04, filter:{cutoff:1100,q:2.4,env:1500,keytrack:.5},
                      fenv:{a:.9,d:1.6,s:.6,r:1.6}, aenv:{a:.85,d:1.4,s:.85,r:1.9},
                      lfo:{rate:.28,pitch:5,filter:340,amp:0}, level:.30 } },
  'Glass Pad':      { engine: 'synth', params: { osc1:{wave:'triangle',level:.7}, osc2:{wave:'sine',oct:1,detune:6,level:.4},
                      filter:{cutoff:2600,q:1.6,env:1800,keytrack:.6}, fenv:{a:1.2,d:2,s:.7,r:2},
                      aenv:{a:1.0,d:1.6,s:.9,r:2.2}, lfo:{rate:.2,pitch:3,filter:500,amp:0}, level:.28 } },
  'Pluck Synth':    { engine: 'synth', params: { osc1:{wave:'sawtooth',level:.8}, osc2:{wave:'square',oct:1,level:.28},
                      filter:{cutoff:700,q:11,env:5200,keytrack:.5}, fenv:{a:.001,d:.14,s:0,r:.1},
                      aenv:{a:.002,d:.30,s:0,r:.16}, level:.44 } },
  'Hollow Organ':   { engine: 'synth', params: { osc1:{wave:'sine',level:.7}, osc2:{wave:'sine',oct:1,level:.5},
                      noise:0, filter:{cutoff:5200,q:.6,env:0,keytrack:.2},
                      aenv:{a:.01,d:.05,s:1,r:.09}, lfo:{rate:6.2,pitch:4,filter:0}, level:.36 } },
  'Retro Square':   { engine: 'synth', params: { osc1:{wave:'square',level:.85}, osc2:{wave:'square',oct:-1,detune:5,level:.4},
                      filter:{cutoff:2400,q:4,env:2200,keytrack:.35}, aenv:{a:.004,d:.18,s:.7,r:.2}, level:.38 } },
  'Acid Line':      { engine: 'synth', params: { osc1:{wave:'sawtooth',oct:-1,level:1}, osc2:{level:0},
                      filter:{cutoff:280,q:16,env:3600,keytrack:.3}, fenv:{a:.002,d:.22,s:.08,r:.2},
                      aenv:{a:.003,d:.3,s:.6,r:.12}, drive:.5, level:.42 } },
  /* — FM 系 — */
  'Grand Piano':    { engine: 'fm', params: { ratio:3.0, index:2.6, indexDecay:.4,
                      aenv:{a:.002,d:2.2,s:0,r:.35}, tone:9000, stereo:.3, level:.62 } },
  'Electric Piano': { engine: 'fm', params: { ratio:2.0, index:3.4, indexDecay:.28,
                      aenv:{a:.002,d:1.5,s:.02,r:.4}, tone:6500, stereo:.35, level:.6 } },
  'FM Bell':        { engine: 'fm', params: { ratio:5.03, index:4.4, indexDecay:.9,
                      aenv:{a:.001,d:3.2,s:0,r:1.2}, tone:12000, stereo:.4, level:.42 } },
  'Marimba':        { engine: 'fm', params: { ratio:4.0, index:3.0, indexDecay:.12,
                      aenv:{a:.001,d:.55,s:0,r:.18}, tone:8000, stereo:.3, level:.55 } },
  /* — ドラム — */
  'Acoustic Kit':   { engine: 'drums', params: { tune:0, snap:.5, decay:1, level:.85 } },
  'Electro Kit':    { engine: 'drums', params: { tune:-2, snap:.85, decay:.72, level:.9,
                      gains:{kick:1.1,snare:.85,clap:.8,hhc:.45,hho:.45} } },
  'Deep House Kit': { engine: 'drums', params: { tune:-3, snap:.35, decay:1.25, level:.88 } }
};

/* ══════════════ ビンテージ実機インスパイア プリセット ══════════════
   いずれも実機の回路構成や音色傾向を参考にした「独自実装のエミュレーション」
   であり、各メーカーとは無関係です。サンプリングも一切していません。      */
const VINTAGE_PRESETS = {
  /* 1970 モノフォニック (3VCO + 24dB ラダーフィルタ の名機を参考に) */
  'Mono Classic 70s Lead': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Analog Saw', morph: 0.18, unison: 2, detune: 7, blend: 0.35, level: 0.85 },
    oscB: { on: true, table: 'Analog Saw', morph: 0.24, oct: 0, fine: 11, unison: 1, level: 0.7 },
    sub: { on: true, wave: 'square', oct: -1, level: 0.45 },
    filter: { cutoff: 1450, res: 8.5, drive: 0.42, keytrack: 0.35, env2: 3400 },
    env1: { a: 0.006, d: 0.4, s: 0.85, r: 0.22 },
    env2: { a: 0.004, d: 0.35, s: 0.25, r: 0.25 },
    matrix: [{ src: 'lfo1', dst: 'pitchA', amt: 0.004 }, { src: 'mod', dst: 'pitchA', amt: 0.02 }],
    lfo1: { rate: 5.4, shape: 'triangle' },
    fx: { driveOn: true, drive: 0.34 },
    voices: 1, level: 0.34 } },

  'Mono Classic 70s Bass': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Analog Saw', morph: 0.30, oct: -1, unison: 1, level: 0.9 },
    oscB: { on: true, table: 'Digital PWM', morph: 0.15, oct: -1, fine: -6, unison: 1, level: 0.6 },
    sub: { on: true, wave: 'sine', oct: -1, level: 0.55 },
    filter: { cutoff: 520, res: 6.5, drive: 0.5, keytrack: 0.25, env2: 1800 },
    env1: { a: 0.003, d: 0.22, s: 0.9, r: 0.12 },
    env2: { a: 0.002, d: 0.18, s: 0.1, r: 0.12 },
    fx: { driveOn: true, drive: 0.42 },
    voices: 1, level: 0.36 } },

  /* 1978 5音ポリ (SSM フィルタ + POLY-MOD の名機を参考に) */
  'Poly Vintage 78': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Analog Saw', morph: 0.22, unison: 1, level: 0.75 },
    oscB: { on: true, table: 'Digital PWM', morph: 0.3, oct: 0, fine: 5, unison: 1, level: 0.55 },
    filter: { cutoff: 1900, res: 5.5, drive: 0.2, keytrack: 0.4, env2: 3000 },
    env1: { a: 0.012, d: 0.7, s: 0.7, r: 0.5 },
    env2: { a: 0.02, d: 0.6, s: 0.3, r: 0.5 },
    lfo2: { rate: 0.55, shape: 'triangle' },
    matrix: [{ src: 'lfo2', dst: 'morphB', amt: 0.45 }, { src: 'vel', dst: 'cutoff', amt: 0.3 }],
    voices: 5, level: 0.30 } },

  /* 1981 8音ポリ ストリングス */
  'Jupiter Strings 81': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Analog Saw', morph: 0.35, unison: 3, detune: 13, blend: 0.9, level: 0.7 },
    oscB: { on: true, table: 'Analog Saw', morph: 0.5, oct: 1, unison: 2, detune: 9, blend: 0.8, level: 0.4 },
    filter: { cutoff: 2600, res: 2.2, drive: 0.1, keytrack: 0.45, env2: 1800 },
    env1: { a: 0.35, d: 1.2, s: 0.85, r: 1.1 },
    env2: { a: 0.5, d: 1.4, s: 0.6, r: 1.0 },
    lfo1: { rate: 0.22, shape: 'sine' },
    matrix: [{ src: 'lfo1', dst: 'pitchA', amt: 0.005 }, { src: 'lfo1', dst: 'cutoff', amt: 0.12 }],
    fx: { chorusOn: true, chorusMix: 0.5, chorusRate: 0.4 },
    voices: 8, level: 0.26 } },

  /* 1982 ポリ + 名物コーラス */
  'Juno Chorus 82': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Analog Saw', morph: 0.2, unison: 1, level: 0.8 },
    oscB: { on: true, table: 'Digital PWM', morph: 0.42, unison: 1, fine: 0, level: 0.45 },
    sub: { on: true, wave: 'square', oct: -1, level: 0.4 },
    filter: { cutoff: 2200, res: 3.5, drive: 0.12, keytrack: 0.4, env2: 2600 },
    env1: { a: 0.01, d: 0.5, s: 0.8, r: 0.45 },
    env2: { a: 0.01, d: 0.45, s: 0.35, r: 0.4 },
    lfo2: { rate: 0.35, shape: 'triangle' },
    matrix: [{ src: 'lfo2', dst: 'morphB', amt: 0.5 }],
    fx: { chorusOn: true, chorusMix: 0.62, chorusRate: 0.62, chorusDepth: 0.0055 },
    voices: 6, level: 0.30 } },

  /* 1995 バーチャルアナログ (VA) リード */
  'VA Lead 95': { engine: 'spectra', group: 'ビンテージシンセ', params: {
    oscA: { table: 'Sync Sweep', morph: 0.12, unison: 4, detune: 16, blend: 0.7, level: 0.85 },
    oscB: { on: true, table: 'Digital PWM', morph: 0.35, oct: 0, fine: 7, unison: 2, detune: 9, level: 0.5 },
    filter: { cutoff: 2800, res: 6.5, drive: 0.3, keytrack: 0.45, env2: 3600 },
    env1: { a: 0.004, d: 0.32, s: 0.8, r: 0.24 },
    env2: { a: 0.002, d: 0.26, s: 0.28, r: 0.2 },
    lfo1: { rate: 5.8, shape: 'sine' },
    matrix: [{ src: 'mod', dst: 'morphA', amt: 0.5 }, { src: 'lfo1', dst: 'pitchA', amt: 0.005 },
             { src: 'vel', dst: 'cutoff', amt: 0.35 }],
    fx: { driveOn: true, drive: 0.26 },
    voices: 6, level: 0.30 } },

  /* 1983 6オペレータ FM デジタルシンセ */
  'FM Digital 83 E.Piano': { engine: 'fm', group: 'ビンテージシンセ', params: {
    ratio: 1.0, index: 4.6, indexDecay: 0.19,
    aenv: { a: 0.001, d: 1.9, s: 0.02, r: 0.35 }, tone: 9500, stereo: 0.35, level: 0.6 } },
  'FM Digital 83 Bass': { engine: 'fm', group: 'ビンテージシンセ', params: {
    ratio: 1.0, index: 3.2, indexDecay: 0.07,
    aenv: { a: 0.001, d: 0.5, s: 0.35, r: 0.14 }, tone: 4200, stereo: 0.05, level: 0.68 } },
  'FM Digital 83 Bell': { engine: 'fm', group: 'ビンテージシンセ', params: {
    ratio: 3.51, index: 5.4, indexDecay: 1.1,
    aenv: { a: 0.001, d: 3.4, s: 0.0, r: 1.4 }, tone: 13000, stereo: 0.45, level: 0.4 } },
  'FM Digital 83 Brass': { engine: 'fm', group: 'ビンテージシンセ', params: {
    ratio: 1.0, index: 2.3, indexDecay: 0.85,
    aenv: { a: 0.075, d: 0.7, s: 0.72, r: 0.28 }, tone: 7200, stereo: 0.25, level: 0.5 } },
  'FM Digital 83 Marimba': { engine: 'fm', group: 'ビンテージシンセ', params: {
    ratio: 4.0, index: 3.1, indexDecay: 0.1,
    aenv: { a: 0.001, d: 0.62, s: 0.0, r: 0.2 }, tone: 8800, stereo: 0.3, level: 0.56 } }
};

/* SPECTRA / ビンテージ / 物理モデル のプリセットを統合カタログへ登録 */
Object.keys(SPECTRA_PRESETS).forEach(name => {
  PRESETS[name] = { engine: 'spectra', params: SPECTRA_PRESETS[name], group: 'SPECTRA' };
});
Object.keys(VINTAGE_PRESETS).forEach(name => {
  PRESETS[name] = VINTAGE_PRESETS[name];
});
Object.keys(PHYS_PRESETS).forEach(name => {
  PRESETS[name] = { engine: 'phys', params: PHYS_PRESETS[name], group: '物理モデル' };
});

/* ══════════════════ ファクトリ ══════════════════ */
const Instruments = {
  PRESETS,
  DRUM_MAP,
  SYNTH_DEFAULTS, FM_DEFAULTS, DRUM_DEFAULTS,

  /* エンジン種別ごとの既定パラメータ */
  defaultsFor(engine) {
    if (engine === 'drums')   return DRUM_DEFAULTS;
    if (engine === 'fm')      return FM_DEFAULTS;
    if (engine === 'spectra') return SPECTRA_DEFAULTS;
    if (engine === 'phys')    return PHYS_DEFAULTS;
    return SYNTH_DEFAULTS;
  },
  /* 部分的なパラメータを既定値で補完して完全な状態にする */
  normalize(instDef) {
    if (!instDef) return { engine: 'synth', preset: 'Classic Lead', params: deepMerge(SYNTH_DEFAULTS, null) };
    instDef.engine = instDef.engine || 'synth';
    instDef.params = deepMerge(this.defaultsFor(instDef.engine), instDef.params);
    return instDef;
  },

  create(ctx, instDef, dest) {
    const def = instDef || { engine: 'synth', preset: 'Classic Lead', params: {} };
    switch (def.engine) {
      case 'drums':   return DrumKit(ctx, def, dest);
      case 'fm':      return FMSynth(ctx, def, dest);
      case 'spectra': return Spectra(ctx, def, dest);
      case 'phys':    return PhysModel(ctx, def, dest);
      default:        return PolySynth(ctx, def, dest);
    }
  },
  /* プリセット名から instrument 定義を作る */
  fromPreset(name) {
    const p = PRESETS[name] || PRESETS['Classic Lead'];
    return { engine: p.engine, preset: name,
             params: deepMerge(this.defaultsFor(p.engine), p.params) };
  },
  isDrum(instDef) { return instDef && instDef.engine === 'drums'; },

  /* 起動時に重い生成物 (PeriodicWave / ノイズバッファ) を先に作っておく。
     初回発音時の生成コストによるレイテンシ・グリッチを防ぐ。 */
  prewarm(ctx) {
    try {
      noiseBuffer(ctx);
      Object.keys(WAVETABLES).forEach(name => {
        const n = wtFrameCount(name);
        for (let i = 0; i < n; i++) wtPeriodicWave(ctx, name, i);
      });
    } catch (e) {}
  },
  /* エンジン表示名 */
  engineLabel(engine) {
    return { spectra: 'SPECTRA ウェーブテーブル', synth: 'アナログ減算合成',
             fm: 'FM シンセシス', drums: 'ドラムシンセ',
             phys: '物理モデリング (撥弦・打弦)' }[engine] || engine;
  },
  /* カテゴリ分け (ライブラリ表示用) */
  category(name) {
    const p = PRESETS[name];
    if (!p) return 'その他';
    if (p.group === 'ビンテージシンセ') return 'ビンテージ実機 (70s〜90s)';
    if (p.group === '物理モデル')       return '物理モデル (生楽器)';
    if (p.engine === 'spectra') return 'SPECTRA (ウェーブテーブル)';
    if (p.engine === 'drums')   return 'ドラム';
    if (p.engine === 'fm')      return 'FM 音源';
    return 'アナログシンセ';
  },
  VINTAGE_PRESETS
};

window.Instruments = Instruments;
window.deepMerge = deepMerge;
window.driveCurve = driveCurve;
