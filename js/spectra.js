/* ══════════════════════════════════════════════════════════════
   spectra.js — SPECTRA ウェーブテーブルシンセサイザー
     ・2 × ウェーブテーブル OSC (最大 8 ボイス ユニゾン / モーフ)
     ・サブ OSC + ノイズ
     ・マルチモードフィルタ (ドライブ付き)
     ・3 エンベロープ + 2 LFO + 8 スロット モジュレーションマトリクス
     ・内蔵 FX (ドライブ / コーラス / ディレイ)
   ══════════════════════════════════════════════════════════════ */
'use strict';

const SPECTRA_DEFAULTS = {
  oscA: { on: true,  table: 'Basic Shapes', morph: 0.14, oct: 0, semi: 0, fine: 0,
          level: 0.75, pan: 0, unison: 3, detune: 18, blend: 0.75 },
  oscB: { on: false, table: 'Analog Saw',   morph: 0.30, oct: -1, semi: 0, fine: 6,
          level: 0.45, pan: 0, unison: 1, detune: 10, blend: 0.5 },
  sub:  { on: false, wave: 'sine', oct: -1, level: 0.4 },
  noise:{ on: false, level: 0.12, color: 6000 },
  filter: { on: true, type: 'lowpass', cutoff: 2400, res: 5, drive: 0.15,
            keytrack: 0.3, env2: 3200 },
  env1: { a: 0.004, d: 0.35, s: 0.75, r: 0.35 },
  env2: { a: 0.004, d: 0.30, s: 0.30, r: 0.30 },
  env3: { a: 0.20,  d: 0.60, s: 0.50, r: 0.50 },
  lfo1: { rate: 4.2, shape: 'sine',     bipolar: true },
  lfo2: { rate: 0.6, shape: 'triangle', bipolar: true },
  matrix: [
    { src: 'none', dst: 'cutoff', amt: 0 }, { src: 'none', dst: 'morphA', amt: 0 },
    { src: 'none', dst: 'pitchA', amt: 0 }, { src: 'none', dst: 'levelA', amt: 0 },
    { src: 'none', dst: 'pan',    amt: 0 }, { src: 'none', dst: 'res',    amt: 0 },
    { src: 'none', dst: 'morphB', amt: 0 }, { src: 'none', dst: 'noise',  amt: 0 }
  ],
  fx: { driveOn: false, drive: 0.3,
        chorusOn: false, chorusRate: 0.5, chorusDepth: 0.004, chorusMix: 0.4,
        delayOn: false, delayTime: 0.28, delayFb: 0.32, delayMix: 0.28 },
  voices: 10, glide: 0, level: 0.42
};

/* モジュレーション先ごとのスケール (amt 1.0 のときの変化量) */
const SPECTRA_DEST = {
  cutoff: { label: 'フィルタ カットオフ', scale: 7000 },
  res:    { label: 'レゾナンス',          scale: 14 },
  morphA: { label: 'OSC A モーフ',        scale: 1 },
  morphB: { label: 'OSC B モーフ',        scale: 1 },
  pitchA: { label: 'OSC A ピッチ',        scale: 1200 },
  pitchB: { label: 'OSC B ピッチ',        scale: 1200 },
  levelA: { label: 'OSC A レベル',        scale: 1 },
  levelB: { label: 'OSC B レベル',        scale: 1 },
  pan:    { label: 'パン',                scale: 1 },
  noise:  { label: 'ノイズ量',            scale: 1 }
};
const SPECTRA_SRC = {
  none: 'なし', env2: 'ENV 2', env3: 'ENV 3',
  lfo1: 'LFO 1', lfo2: 'LFO 2', vel: 'ベロシティ', key: 'キートラック',
  mod: 'モジュレーションホイール'
};

function spectraShaper(ctx, amount) {
  const sh = ctx.createWaveShaper();
  sh.curve = driveCurve(amount);
  sh.oversample = '2x';
  return sh;
}

function Spectra(ctx, def, dest) {
  const P = deepMerge(SPECTRA_DEFAULTS, def.params);
  const self = { type: 'spectra', params: P, def, engineName: 'SPECTRA' };

  /* ══ 出力チェーン: voiceBus → FX → out ══ */
  const voiceBus = ctx.createGain();
  const out = ctx.createGain();
  out.gain.value = P.level;

  let node = voiceBus;
  const fxNodes = {};
  if (P.fx.driveOn) {
    const sh = spectraShaper(ctx, P.fx.drive);
    const post = ctx.createGain(); post.gain.value = 1 / (1 + P.fx.drive * 1.4);
    node.connect(sh); sh.connect(post); node = post;
    fxNodes.drive = sh;
  }
  if (P.fx.chorusOn) {
    const dry = ctx.createGain(); dry.gain.value = 1 - P.fx.chorusMix * 0.4;
    const wet = ctx.createGain(); wet.gain.value = P.fx.chorusMix;
    const merge = ctx.createGain();
    const lfo = ctx.createOscillator(); lfo.frequency.value = P.fx.chorusRate;
    try { lfo.start(); } catch (e) {}
    [-1, 1].forEach((sgn, i) => {
      const d = ctx.createDelay(0.08);
      d.delayTime.value = 0.014 + i * 0.007;
      const dg = ctx.createGain(); dg.gain.value = P.fx.chorusDepth * sgn;
      lfo.connect(dg); dg.connect(d.delayTime);
      const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      node.connect(d);
      if (pan) { pan.pan.value = sgn * 0.85; d.connect(pan); pan.connect(wet); } else d.connect(wet);
    });
    node.connect(dry);
    dry.connect(merge); wet.connect(merge);
    node = merge;
    fxNodes.chorusLfo = lfo;
  }
  if (P.fx.delayOn) {
    const d = ctx.createDelay(2); d.delayTime.value = P.fx.delayTime;
    const fb = ctx.createGain(); fb.gain.value = U.clamp(P.fx.delayFb, 0, 0.85);
    const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5200;
    const wet = ctx.createGain(); wet.gain.value = P.fx.delayMix;
    const merge = ctx.createGain();
    node.connect(merge);
    node.connect(d); d.connect(tone); tone.connect(fb); fb.connect(d);
    d.connect(wet); wet.connect(merge);
    node = merge;
  }
  node.connect(out);
  out.connect(dest);

  /* ══ グローバル LFO ══ */
  function buildLfo(cfg) {
    const o = ctx.createOscillator();
    o.type = cfg.shape === 'random' ? 'sawtooth' : cfg.shape;
    o.frequency.value = cfg.rate;
    try { o.start(); } catch (e) {}
    return o;
  }
  const lfo1 = buildLfo(P.lfo1);
  const lfo2 = buildLfo(P.lfo2);

  /* モジュレーションホイール (MIDI CC1) をモジュレーション源として供給 */
  const modSrc = ctx.createConstantSource();
  modSrc.offset.value = 0;
  try { modSrc.start(); } catch (e) {}

  /* ══ ボイス管理 ══ */
  let bendCents = 0;
  const voices = [];            /* 発音中 (ノートオフ待ち) */
  const held = new Map();       /* midi -> voice[] */
  const maxVoices = U.clamp(P.voices | 0, 1, 16);

  /* ADSR を持つ ConstantSourceNode (モジュレーション源) */
  function envSource(time, env, peak) {
    const cs = ctx.createConstantSource();
    const p = cs.offset;
    p.setValueAtTime(0, time);
    p.linearRampToValueAtTime(peak, time + Math.max(0.0005, env.a));
    p.setTargetAtTime(peak * env.s, time + Math.max(0.0005, env.a), Math.max(0.008, env.d / 3));
    cs.start(time);
    return cs;
  }
  function envRelease(cs, env, time) {
    try {
      cs.offset.cancelScheduledValues(time);
      cs.offset.setValueAtTime(Math.max(0.0001, cs.offset.value), time);
      cs.offset.setTargetAtTime(0, time, Math.max(0.01, env.r) / 3.2);
    } catch (e) {}
  }

  /* モーフ用のフレーム範囲 (マトリクスで大きく振る場合は広げる) */
  function morphFrames(oscCfg, which) {
    const n = wtFrameCount(oscCfg.table);
    let range = 0;
    P.matrix.forEach(m => {
      if (m.src !== 'none' && m.dst === which) range = Math.max(range, Math.abs(m.amt));
    });
    const pos = U.clamp(oscCfg.morph, 0, 1) * (n - 1);
    if (range < 0.02) {
      const lo = Math.floor(pos), hi = Math.min(n - 1, lo + 1);
      return { lo, hi, mix: pos - lo, span: 1 };
    }
    const half = range * (n - 1) / 2;
    const lo = Math.round(U.clamp(pos - half, 0, n - 1));
    const hi = Math.round(U.clamp(pos + half, 0, n - 1));
    return { lo, hi, mix: hi === lo ? 0 : (pos - lo) / (hi - lo), span: Math.max(1, hi - lo) };
  }

  /* ══ 1 ボイス生成 ══ */
  function makeVoice(midi, time, vel) {
    const v = { midi, time, mods: [], nodes: [], oscs: [], released: false };
    const velN = Math.pow(U.clamp(vel, 1, 127) / 127, 1.25);
    const freq = U.midiToFreq(midi);

    /* --- アンプ --- */
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    const e1 = P.env1;
    amp.gain.linearRampToValueAtTime(velN, time + Math.max(0.0006, e1.a));
    amp.gain.setTargetAtTime(Math.max(0.0001, velN * e1.s),
                             time + Math.max(0.0006, e1.a), Math.max(0.008, e1.d / 3));
    const vpan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (vpan) { amp.connect(vpan); vpan.connect(voiceBus); } else amp.connect(voiceBus);
    v.amp = amp; v.vpan = vpan;

    /* --- フィルタ --- */
    let filterIn = amp, filt = null, fdrive = null;
    if (P.filter.on) {
      filt = ctx.createBiquadFilter();
      filt.type = P.filter.type;
      filt.Q.value = U.clamp(P.filter.res, 0.0001, 24);
      const base = U.clamp(P.filter.cutoff * Math.pow(2, ((midi - 60) / 12) * P.filter.keytrack), 25, 19000);
      filt.frequency.setValueAtTime(base, time);
      v.filtBase = base;
      if (P.filter.drive > 0.01) {
        fdrive = spectraShaper(ctx, P.filter.drive);
        const comp = ctx.createGain(); comp.gain.value = 1 / (1 + P.filter.drive * 1.2);
        filt.connect(fdrive); fdrive.connect(comp); comp.connect(amp);
      } else {
        filt.connect(amp);
      }
      filterIn = filt;
      v.filt = filt;
    }

    /* --- ENV2 / ENV3 --- */
    const needEnv2 = (P.filter.on && Math.abs(P.filter.env2) > 1) ||
                     P.matrix.some(m => m.src === 'env2' && m.amt);
    const needEnv3 = P.matrix.some(m => m.src === 'env3' && m.amt);
    if (needEnv2) { v.env2 = envSource(time, P.env2, 1); v.nodes.push(v.env2); }
    if (needEnv3) { v.env3 = envSource(time, P.env3, 1); v.nodes.push(v.env3); }

    /* フィルタエンベロープ (ENV2 → カットオフ) */
    if (filt && v.env2 && Math.abs(P.filter.env2) > 1) {
      const g = ctx.createGain(); g.gain.value = P.filter.env2;
      v.env2.connect(g); g.connect(filt.frequency);
      v.nodes.push(g);
    }

    /* --- OSC 構築 (モーフ用クロスフェードゲインを軸に配線) --- */
    const buildOsc = (cfg, which) => {
      if (!cfg.on || cfg.level <= 0.001) return null;
      const bus = ctx.createGain(); bus.gain.value = cfg.level;
      const busPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (busPan) { busPan.pan.value = U.clamp(cfg.pan, -1, 1); bus.connect(busPan); busPan.connect(filterIn); }
      else bus.connect(filterIn);

      const fr = morphFrames(cfg, which === 'A' ? 'morphA' : 'morphB');
      const pwLo = wtPeriodicWave(ctx, cfg.table, fr.lo);
      const pwHi = wtPeriodicWave(ctx, cfg.table, fr.hi);
      const uni = U.clamp(cfg.unison | 0, 1, 8);

      /* モーフ用クロスフェードゲイン (LFO/ENV でモジュレート可能) */
      const gLo = ctx.createGain(), gHi = ctx.createGain();
      gLo.gain.setValueAtTime(U.clamp(1 - fr.mix, 0, 1), time);
      gHi.gain.setValueAtTime(U.clamp(fr.mix, 0, 1), time);
      gLo.connect(bus); gHi.connect(bus);

      const oscList = [];
      for (let u = 0; u < uni; u++) {
        const spread = uni > 1 ? ((u - (uni - 1) / 2) / ((uni - 1) / 2)) : 0;
        const cents = cfg.oct * 1200 + cfg.semi * 100 + cfg.fine
                      + spread * cfg.detune + (Math.random() - 0.5) * 1.6;
        const usePan = !!ctx.createStereoPanner;
        /* 1 ユニゾン = lo/hi 2 本の OSC。それぞれ別のモーフゲインへ */
        [[pwLo, gLo], [pwHi, gHi]].forEach(([pw, g]) => {
          const o = ctx.createOscillator();
          o.setPeriodicWave(pw);
          o.frequency.setValueAtTime(freq, time);
          o.detune.setValueAtTime(cents + bendCents, time);
          o.__base = cents;
          const pg = ctx.createGain(); pg.gain.value = 1 / Math.sqrt(uni);
          o.connect(pg);
          if (usePan) {
            const p2 = ctx.createStereoPanner();
            p2.pan.value = U.clamp(spread * cfg.blend, -1, 1);
            pg.connect(p2); p2.connect(g);
          } else pg.connect(g);
          o.start(time);
          v.oscs.push(o); oscList.push(o);
        });
      }
      return { bus, busPan, gLo, gHi, oscList };
    };

    const oA = buildOsc(P.oscA, 'A');
    const oB = buildOsc(P.oscB, 'B');
    v.oA = oA; v.oB = oB;

    /* --- サブ OSC --- */
    if (P.sub.on && P.sub.level > 0.001) {
      const o = ctx.createOscillator();
      o.type = P.sub.wave;
      o.frequency.setValueAtTime(freq * Math.pow(2, P.sub.oct), time);
      const g = ctx.createGain(); g.gain.value = P.sub.level;
      o.connect(g); g.connect(filterIn);
      o.start(time); v.oscs.push(o);
    }

    /* --- ノイズ --- */
    if (P.noise.on && P.noise.level > 0.001) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(ctx); s.loop = true;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = P.noise.color;
      const g = ctx.createGain(); g.gain.value = P.noise.level;
      s.connect(lp); lp.connect(g); g.connect(filterIn);
      s.start(time); v.noiseSrc = s; v.noiseGain = g;
    }

    /* --- モジュレーションマトリクス配線 --- */
    const paramsFor = dst => {
      switch (dst) {
        case 'cutoff': return filt ? [{ p: filt.frequency }] : [];
        case 'res':    return filt ? [{ p: filt.Q }] : [];
        case 'morphA': return oA ? [{ p: oA.gHi.gain }, { p: oA.gLo.gain, inv: true }] : [];
        case 'morphB': return oB ? [{ p: oB.gHi.gain }, { p: oB.gLo.gain, inv: true }] : [];
        case 'pitchA': return oA ? oA.oscList.map(o => ({ p: o.detune })) : [];
        case 'pitchB': return oB ? oB.oscList.map(o => ({ p: o.detune })) : [];
        case 'levelA': return oA ? [{ p: oA.bus.gain }] : [];
        case 'levelB': return oB ? [{ p: oB.bus.gain }] : [];
        case 'pan':    return vpan ? [{ p: vpan.pan }] : [];
        case 'noise':  return v.noiseGain ? [{ p: v.noiseGain.gain }] : [];
      }
      return [];
    };

    P.matrix.forEach(m => {
      if (!m || m.src === 'none' || !m.amt) return;
      const info = SPECTRA_DEST[m.dst]; if (!info) return;
      const targets = paramsFor(m.dst); if (!targets.length) return;
      const amount = m.amt * info.scale;

      if (m.src === 'vel' || m.src === 'key') {
        const k = m.src === 'vel' ? velN : U.clamp((midi - 60) / 48, -1, 1);
        targets.forEach(t => {
          try {
            const cur = t.p.value;
            t.p.setValueAtTime(cur + amount * k * (t.inv ? -1 : 1), time);
          } catch (e) {}
        });
        return;
      }
      const src = m.src === 'lfo1' ? lfo1 : m.src === 'lfo2' ? lfo2 :
                  m.src === 'env2' ? v.env2 : m.src === 'env3' ? v.env3 :
                  m.src === 'mod'  ? modSrc : null;
      if (!src) return;
      targets.forEach(t => {
        const g = ctx.createGain();
        g.gain.value = amount * (t.inv ? -1 : 1);
        src.connect(g); g.connect(t.p);
        v.mods.push(g);
      });
    });

    return v;
  }

  function releaseVoice(v, time) {
    if (v.released) return;
    v.released = true;
    const r1 = Math.max(0.012, P.env1.r);
    try {
      v.amp.gain.cancelScheduledValues(time);
      v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), time);
      v.amp.gain.setTargetAtTime(0.0001, time, r1 / 3.2);
    } catch (e) {}
    if (v.env2) envRelease(v.env2, P.env2, time);
    if (v.env3) envRelease(v.env3, P.env3, time);

    const stopAt = time + r1 * 1.7 + 0.08;
    v.stopAt = stopAt;
    v.oscs.forEach(o => { try { o.stop(stopAt); } catch (e) {} });
    if (v.noiseSrc) { try { v.noiseSrc.stop(stopAt); } catch (e) {} }
    if (v.env2) { try { v.env2.stop(stopAt); } catch (e) {} }
    if (v.env3) { try { v.env3.stop(stopAt); } catch (e) {} }

    setTimeout(() => {
      v.mods.forEach(g => { try { g.disconnect(); } catch (e) {} });
      try { v.amp.disconnect(); } catch (e) {}
      if (v.vpan) { try { v.vpan.disconnect(); } catch (e) {} }
      if (v.filt) { try { v.filt.disconnect(); } catch (e) {} }
      const i = voices.indexOf(v); if (i >= 0) voices.splice(i, 1);
    }, Math.max(0, (stopAt - ctx.currentTime) * 1000) + 260);
  }

  self.noteOn = function (midi, time, vel, dur) {
    time = Math.max(time, ctx.currentTime);
    /* ボイススティール */
    while (voices.filter(x => !x.released).length >= maxVoices) {
      const oldest = voices.find(x => !x.released);
      if (!oldest) break;
      releaseVoice(oldest, time);
    }
    const v = makeVoice(midi, time, vel == null ? 100 : vel);
    voices.push(v);
    if (dur != null) {
      releaseVoice(v, time + Math.max(0.02, dur));
    } else {
      const arr = held.get(midi) || []; arr.push(v); held.set(midi, arr);
    }
    return v;
  };
  self.noteOff = function (midi, time) {
    const arr = held.get(midi);
    if (!arr || !arr.length) return;
    const v = arr.shift();
    if (!arr.length) held.delete(midi);
    releaseVoice(v, Math.max(time || ctx.currentTime, ctx.currentTime));
  };
  self.allOff = function () {
    const t = ctx.currentTime;
    voices.slice().forEach(v => releaseVoice(v, t));
    held.clear();
  };
  self.dispose = function () {
    self.allOff();
    try { lfo1.stop(); lfo2.stop(); modSrc.stop(); } catch (e) {}
    if (fxNodes.chorusLfo) { try { fxNodes.chorusLfo.stop(); } catch (e) {} }
    try { out.disconnect(); voiceBus.disconnect(); } catch (e) {}
  };
  self.setLevel = l => { out.gain.value = l; };
  self.activeVoices = () => voices.filter(v => !v.released).length;

  /* ピッチベンド (半音単位) — 発音中の全オシレータへ即時反映 */
  self.setBend = function (semi) {
    bendCents = semi * 100;
    const t = ctx.currentTime;
    voices.forEach(v => v.oscs.forEach(o => {
      if (o.__base == null) return;
      try { o.detune.setTargetAtTime(o.__base + bendCents, t, 0.005); } catch (e) {}
    }));
  };
  /* 再構築せずに反映できるパラメータ (演奏を止めない) */
  self.setLive = function (path, v) {
    const t = ctx.currentTime;
    try {
      switch (path) {
        case 'level':      out.gain.setTargetAtTime(v, t, 0.012); return true;
        case 'lfo1.rate':  lfo1.frequency.setTargetAtTime(v, t, 0.02); return true;
        case 'lfo2.rate':  lfo2.frequency.setTargetAtTime(v, t, 0.02); return true;
        case 'filter.cutoff':
          voices.forEach(vc => {
            if (!vc.filt) return;
            const base = U.clamp(v * Math.pow(2, ((vc.midi - 60) / 12) * P.filter.keytrack), 25, 19000);
            vc.filt.frequency.setTargetAtTime(base, t, 0.015);
          });
          return true;
        case 'filter.res':
          voices.forEach(vc => { if (vc.filt) vc.filt.Q.setTargetAtTime(U.clamp(v, 0.0001, 24), t, 0.015); });
          return true;
      }
    } catch (e) {}
    return false;
  };

  /* モジュレーションホイール */
  self.setModWheel = function (v) {
    try { modSrc.offset.setTargetAtTime(U.clamp(v, 0, 1), ctx.currentTime, 0.01); } catch (e) {}
  };
  /* UI の波形表示用に出力を覗く */
  self.tapOutput = function (analyser) { try { out.connect(analyser); } catch (e) {} };
  return self;
}

/* ══════════════ SPECTRA プリセット ══════════════ */
const SPECTRA_PRESETS = {
  'Spectra Init': {},

  'Neon Supersaw': {
    oscA: { table: 'Analog Saw', morph: 0.25, unison: 7, detune: 26, blend: 1, level: 0.8 },
    oscB: { on: true, table: 'Analog Saw', morph: 0.5, oct: 0, fine: -8, unison: 5, detune: 18, blend: 0.9, level: 0.5 },
    sub: { on: true, wave: 'sine', oct: -1, level: 0.32 },
    filter: { cutoff: 5200, res: 2.5, drive: 0.28, env2: 2600 },
    env1: { a: 0.008, d: 0.6, s: 0.85, r: 0.5 },
    env2: { a: 0.004, d: 0.5, s: 0.2, r: 0.4 },
    matrix: [{ src: 'lfo2', dst: 'morphA', amt: 0.35 }, { src: 'vel', dst: 'cutoff', amt: 0.3 }],
    lfo2: { rate: 0.35, shape: 'triangle' },
    fx: { driveOn: true, drive: 0.22, chorusOn: true, chorusMix: 0.35 },
    level: 0.30
  },

  'Vowel Growl': {
    oscA: { table: 'Vowel Formant', morph: 0.2, unison: 3, detune: 12, level: 0.85 },
    oscB: { on: true, table: 'Growl', morph: 0.4, oct: -1, unison: 2, detune: 8, level: 0.55 },
    filter: { cutoff: 900, res: 9, drive: 0.5, env2: 3400 },
    env1: { a: 0.005, d: 0.3, s: 0.8, r: 0.25 },
    env2: { a: 0.002, d: 0.25, s: 0.25, r: 0.2 },
    lfo1: { rate: 5.5, shape: 'sine' },
    matrix: [{ src: 'lfo1', dst: 'morphA', amt: 0.6 }, { src: 'lfo1', dst: 'cutoff', amt: 0.25 },
             { src: 'env2', dst: 'morphB', amt: 0.4 }],
    fx: { driveOn: true, drive: 0.45 },
    level: 0.32
  },

  'Glass Bells': {
    oscA: { table: 'Bell Metal', morph: 0.1, unison: 2, detune: 8, level: 0.8 },
    oscB: { on: true, table: 'Harmonic Stack', morph: 0.7, oct: 1, unison: 1, level: 0.35 },
    filter: { cutoff: 7000, res: 1.2, drive: 0, env2: 2200 },
    env1: { a: 0.001, d: 2.6, s: 0.0, r: 1.2 },
    env2: { a: 0.001, d: 0.9, s: 0.0, r: 0.6 },
    matrix: [{ src: 'env3', dst: 'morphA', amt: 0.5 }, { src: 'vel', dst: 'levelB', amt: 0.4 }],
    env3: { a: 0.002, d: 1.8, s: 0.1, r: 1 },
    fx: { delayOn: true, delayTime: 0.32, delayFb: 0.36, delayMix: 0.3 },
    level: 0.34
  },

  'Deep Reese': {
    oscA: { table: 'Analog Saw', morph: 0.6, oct: -2, unison: 4, detune: 30, blend: 0.6, level: 0.9 },
    oscB: { on: true, table: 'Analog Saw', morph: 0.65, oct: -2, fine: 14, unison: 4, detune: 34, blend: 0.6, level: 0.8 },
    sub: { on: true, wave: 'sine', oct: -1, level: 0.5 },
    filter: { cutoff: 620, res: 6, drive: 0.42, keytrack: 0.15, env2: 900 },
    env1: { a: 0.004, d: 0.2, s: 0.95, r: 0.2 },
    lfo1: { rate: 0.28, shape: 'sine' },
    matrix: [{ src: 'lfo1', dst: 'cutoff', amt: 0.22 }, { src: 'lfo1', dst: 'pitchB', amt: 0.02 }],
    fx: { driveOn: true, drive: 0.5 },
    level: 0.34
  },

  'Cosmic Pad': {
    oscA: { table: 'Soft Pad', morph: 0.3, unison: 6, detune: 22, blend: 1, level: 0.7 },
    oscB: { on: true, table: 'Vowel Formant', morph: 0.55, oct: 1, unison: 3, detune: 14, blend: 1, level: 0.32 },
    noise: { on: true, level: 0.05, color: 3200 },
    filter: { cutoff: 1500, res: 2.2, drive: 0.1, env2: 2400 },
    env1: { a: 1.1, d: 1.8, s: 0.9, r: 2.4 },
    env2: { a: 1.6, d: 2.2, s: 0.6, r: 2 },
    lfo1: { rate: 0.14, shape: 'sine' }, lfo2: { rate: 0.22, shape: 'triangle' },
    matrix: [{ src: 'lfo1', dst: 'morphA', amt: 0.45 }, { src: 'lfo2', dst: 'pan', amt: 0.5 },
             { src: 'lfo2', dst: 'morphB', amt: 0.3 }],
    fx: { chorusOn: true, chorusMix: 0.5, chorusRate: 0.3 },
    level: 0.26
  },

  'Pluck Nova': {
    oscA: { table: 'Digital PWM', morph: 0.2, unison: 3, detune: 14, level: 0.8 },
    oscB: { on: true, table: 'Basic Shapes', morph: 0.55, oct: 1, unison: 1, level: 0.28 },
    filter: { cutoff: 700, res: 10, drive: 0.2, env2: 6200 },
    env1: { a: 0.002, d: 0.34, s: 0.0, r: 0.24 },
    env2: { a: 0.001, d: 0.16, s: 0.0, r: 0.14 },
    matrix: [{ src: 'vel', dst: 'cutoff', amt: 0.4 }],
    fx: { delayOn: true, delayTime: 0.25, delayFb: 0.3, delayMix: 0.26 },
    level: 0.34
  },

  'Hyper Lead': {
    oscA: { table: 'Sync Sweep', morph: 0.15, unison: 5, detune: 20, blend: 0.9, level: 0.85 },
    oscB: { on: true, table: 'Digital PWM', morph: 0.35, oct: 0, fine: 9, unison: 3, detune: 12, level: 0.45 },
    filter: { cutoff: 3400, res: 4.5, drive: 0.35, env2: 3000 },
    env1: { a: 0.004, d: 0.4, s: 0.8, r: 0.3 },
    env2: { a: 0.002, d: 0.3, s: 0.3, r: 0.25 },
    lfo1: { rate: 5.6, shape: 'sine' },
    matrix: [{ src: 'lfo1', dst: 'pitchA', amt: 0.006 }, { src: 'env3', dst: 'morphA', amt: 0.5 }],
    env3: { a: 0.35, d: 1.2, s: 0.4, r: 0.6 },
    fx: { driveOn: true, drive: 0.3, chorusOn: true, chorusMix: 0.28 },
    level: 0.30
  },

  'Dust Texture': {
    oscA: { table: 'Dust', morph: 0.2, unison: 4, detune: 24, blend: 1, level: 0.7 },
    oscB: { on: true, table: 'Soft Pad', morph: 0.8, oct: -1, unison: 2, level: 0.4 },
    noise: { on: true, level: 0.14, color: 8000 },
    filter: { cutoff: 1800, res: 3.5, drive: 0.25, env2: 2000 },
    env1: { a: 0.6, d: 1.4, s: 0.7, r: 1.6 },
    lfo1: { rate: 0.09, shape: 'triangle' },
    matrix: [{ src: 'lfo1', dst: 'morphA', amt: 0.7 }, { src: 'lfo1', dst: 'noise', amt: 0.3 }],
    fx: { chorusOn: true, chorusMix: 0.4, delayOn: true, delayMix: 0.22 },
    level: 0.26
  }
};

window.Spectra = Spectra;
window.SPECTRA_DEFAULTS = SPECTRA_DEFAULTS;
window.SPECTRA_PRESETS = SPECTRA_PRESETS;
window.SPECTRA_DEST = SPECTRA_DEST;
window.SPECTRA_SRC = SPECTRA_SRC;
