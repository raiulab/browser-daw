/* ══════════════════════════════════════════════════════════════
   effects.js — インサートエフェクト (プラグイン相当)
   各エフェクトは { input, output, type, params, setParam(k,v) } を返す
   ══════════════════════════════════════════════════════════════ */
'use strict';

const FX_DEFS = {
  comp: {
    label: 'Compressor',
    params: { threshold: -20, ratio: 4, attack: 0.006, release: 0.16, knee: 8, makeup: 1.35 },
    ranges: { threshold: [-60, 0, 1, 'dB'], ratio: [1, 20, .1, ':1'], attack: [0.0005, .3, .0005, 's'],
              release: [.01, 1.2, .005, 's'], knee: [0, 40, 1, 'dB'], makeup: [.5, 4, .01, '×'] }
  },
  dist: {
    label: 'Overdrive',
    params: { drive: 0.4, tone: 4200, mix: 1, out: 0.65 },
    ranges: { drive: [0, 1, .01, ''], tone: [400, 14000, 50, 'Hz'], mix: [0, 1, .01, ''], out: [0, 1.5, .01, ''] }
  },
  chorus: {
    label: 'Chorus',
    params: { rate: 0.55, depth: 0.0045, delay: 0.018, mix: 0.42, spread: 1 },
    ranges: { rate: [.05, 6, .01, 'Hz'], depth: [0, .012, .0001, 's'], delay: [.004, .04, .001, 's'],
              mix: [0, 1, .01, ''], spread: [0, 1, .01, ''] }
  },
  phaser: {
    label: 'Phaser',
    params: { rate: 0.35, depth: 900, base: 500, feedback: 0.35, mix: 0.5, stages: 6 },
    ranges: { rate: [.02, 6, .01, 'Hz'], depth: [50, 3000, 10, 'Hz'], base: [100, 2000, 10, 'Hz'],
              feedback: [0, .85, .01, ''], mix: [0, 1, .01, ''], stages: [2, 10, 2, ''] }
  },
  autofilter: {
    label: 'Auto Filter',
    params: { rate: 2, depth: 1800, base: 700, q: 6, type: 'lowpass', mix: 1 },
    ranges: { rate: [.05, 12, .01, 'Hz'], depth: [0, 6000, 10, 'Hz'], base: [80, 6000, 10, 'Hz'],
              q: [.3, 22, .1, ''], mix: [0, 1, .01, ''] }
  },
  tremolo: {
    label: 'Tremolo',
    params: { rate: 5.5, depth: 0.6, shape: 'sine' },
    ranges: { rate: [.1, 20, .05, 'Hz'], depth: [0, 1, .01, ''] }
  },
  delay: {
    label: 'Delay (Insert)',
    params: { time: 0.28, feedback: 0.3, tone: 5000, mix: 0.3 },
    ranges: { time: [.01, 1.5, .005, 's'], feedback: [0, .88, .01, ''], tone: [300, 16000, 50, 'Hz'], mix: [0, 1, .01, ''] }
  },
  bitcrush: {
    label: 'Bitcrusher',
    params: { bits: 8, tone: 6000, mix: 0.7 },
    ranges: { bits: [2, 16, 1, 'bit'], tone: [300, 16000, 50, 'Hz'], mix: [0, 1, .01, ''] }
  },
  analogdelay: {
    label: 'Analog Delay (テープ / BBD)',
    params: { sync: 1, division: 0.5, time: 0.32, feedback: 0.38, mix: 0.34,
              tone: 3200, lowcut: 160, wow: 0.35, flutter: 0.2, drive: 0.3,
              pingpong: 1, spread: 0.85 },
    ranges: { division: [0.0625, 4, 0.0625, ' 拍'], time: [0.02, 2, 0.005, ' s'],
              feedback: [0, 0.92, 0.01, ''], mix: [0, 1, 0.01, ''],
              tone: [400, 12000, 50, ' Hz'], lowcut: [20, 900, 5, ' Hz'],
              wow: [0, 1, 0.01, ''], flutter: [0, 1, 0.01, ''],
              drive: [0, 1, 0.01, ''], spread: [0, 1, 0.01, ''] }
  },
  analogverb: {
    label: 'Analog Reverb (プレート / スプリング)',
    params: { mode: 'plate', size: 0.6, decay: 0.72, damp: 5200, lowcut: 160,
              predelay: 24, diffusion: 0.72, modulation: 0.4, width: 1,
              mix: 0.32, drive: 0.12 },
    ranges: { size: [0.1, 1, 0.01, ''], decay: [0.05, 0.95, 0.01, ''],
              damp: [800, 16000, 50, ' Hz'], lowcut: [20, 900, 5, ' Hz'],
              predelay: [0, 200, 1, ' ms'], diffusion: [0, 0.85, 0.01, ''],
              modulation: [0, 1, 0.01, ''], width: [0, 1.5, 0.01, ''],
              mix: [0, 1, 0.01, ''], drive: [0, 1, 0.01, ''] }
  },
  guitaramp: {
    label: 'Guitar Amp (70s ハードロック)',
    params: { gain: 0.62, bright: 1, bass: 0.55, mid: 0.42, treble: 0.62,
              presence: 0.5, sag: 0.35, master: 0.55, cab: '4x12', out: 0.6 },
    ranges: { gain: [0, 1, .01, ''], bass: [0, 1, .01, ''], mid: [0, 1, .01, ''],
              treble: [0, 1, .01, ''], presence: [0, 1, .01, ''], sag: [0, 1, .01, ''],
              master: [0, 1, .01, ''], out: [0, 1.5, .01, ''] }
  },
  bassamp: {
    label: 'Bass Amp (70s ロック)',
    params: { gain: 0.45, blend: 0.55, bass: 0.6, lowmid: 0.45, himid: 0.5, treble: 0.5,
              comp: 0.35, cab: '8x10', out: 0.65 },
    ranges: { gain: [0, 1, .01, ''], blend: [0, 1, .01, ''], bass: [0, 1, .01, ''],
              lowmid: [0, 1, .01, ''], himid: [0, 1, .01, ''], treble: [0, 1, .01, ''],
              comp: [0, 1, .01, ''], out: [0, 1.5, .01, ''] }
  },
  eq: {
    label: 'Channel EQ (extra)',
    params: { f1: 250, g1: 0, q1: 1, f2: 1500, g2: 0, q2: 1, f3: 6000, g3: 0, q3: 1 },
    ranges: { f1: [30, 800, 5, 'Hz'], g1: [-18, 18, .5, 'dB'], q1: [.2, 10, .1, ''],
              f2: [200, 6000, 20, 'Hz'], g2: [-18, 18, .5, 'dB'], q2: [.2, 10, .1, ''],
              f3: [1000, 18000, 50, 'Hz'], g3: [-18, 18, .5, 'dB'], q3: [.2, 10, .1, ''] }
  }
};


/* ── シュレーダー型オールパス (拡散器) ────────────────────────
     y = -g·x + d,  d = delay(x + g·d)                          */
function makeAllpass(ctx, timeSec, g, maxDelay) {
  const sum = ctx.createGain();
  const delay = ctx.createDelay(maxDelay || 0.2);
  delay.delayTime.value = timeSec;
  const fb = ctx.createGain(); fb.gain.value = g;
  const ff = ctx.createGain(); ff.gain.value = -g;
  const out = ctx.createGain();
  const inp = ctx.createGain();

  inp.connect(sum);
  sum.connect(delay);
  delay.connect(fb); fb.connect(sum);
  delay.connect(out);
  inp.connect(ff); ff.connect(out);
  return { input: inp, output: out, delay, fb, ff };
}

/* ── テープ / BBD 風の飽和カーブ (非対称でやや倍音が付く) ── */
function tapeCurve(amount) {
  const n = 2048, c = new Float32Array(n);
  const k = 1 + amount * 5;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const y = Math.tanh(k * x) / Math.tanh(k);
    c[i] = y * 0.94 + 0.06 * Math.tanh(k * 0.6 * (x + 0.06)) / Math.tanh(k * 0.6);
  }
  return c;
}


/* ── 真空管的な非対称サチュレーション ──
     プラス側とマイナス側で圧縮量を変え、偶数次倍音を生む。         */
function tubeCurve(drive, asym) {
  const n = 4096, c = new Float32Array(n);
  const k = 1 + drive * 24;
  const a = asym == null ? 0.62 : asym;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const kk = x >= 0 ? k : k * a;
    c[i] = Math.tanh(kk * x) / Math.tanh(kk);
  }
  return c;
}

/* ── キャビネットのスピーカー特性 (フィルタ縦続で近似) ──
     畳み込みを使わないので軽く、パラメータで連続的に変えられる。   */
function buildCabinet(ctx, kind) {
  const specs = {
    '4x12': { hp: 88, lp: 4600, peaks: [[110, 1.0, 3.5], [780, 1.4, -5.5], [2300, 1.8, 4.5], [3800, 2.4, -3]] },
    '2x12': { hp: 96, lp: 5600, peaks: [[140, 1.0, 2.5], [900, 1.3, -3.5], [2800, 1.6, 3.5]] },
    '1x12': { hp: 110, lp: 6200, peaks: [[190, 1.1, 2.0], [1100, 1.2, -2.5], [3200, 1.5, 2.5]] },
    '8x10': { hp: 42, lp: 3600, peaks: [[80, 0.9, 3.0], [520, 1.2, -4.0], [1600, 1.4, 2.0]] },
    '1x15': { hp: 36, lp: 2800, peaks: [[70, 0.8, 4.0], [420, 1.1, -3.0], [1200, 1.3, 1.5]] }
  };
  const sp = specs[kind] || specs['4x12'];
  const inp = ctx.createGain();
  let node = inp;
  /* 12dB/oct のハイパス・ローパス */
  for (let i = 0; i < 2; i++) {
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
    hp.frequency.value = sp.hp; hp.Q.value = 0.7071;
    node.connect(hp); node = hp;
  }
  for (let i = 0; i < 2; i++) {
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.value = sp.lp; lp.Q.value = i ? 1.1 : 0.7071;
    node.connect(lp); node = lp;
  }
  sp.peaks.forEach(([f, q, g]) => {
    const b = ctx.createBiquadFilter(); b.type = 'peaking';
    b.frequency.value = f; b.Q.value = q; b.gain.value = g;
    node.connect(b); node = b;
  });
  return { input: inp, output: node };
}

function bitCurve(bits) {
  const n = 2048, c = new Float32Array(n);
  const steps = Math.pow(2, U.clamp(bits, 1, 16));
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = Math.round(x * steps) / steps;
  }
  return c;
}

const FX = {
  DEFS: FX_DEFS,

  defaultData(type) {
    const d = FX_DEFS[type];
    return { id: U.uid('fx'), type, on: true, params: JSON.parse(JSON.stringify(d.params)) };
  },

  create(ctx, data) {
    const def = FX_DEFS[data.type];
    if (!def) return null;
    const P = Object.assign({}, def.params, data.params || {});
    data.params = P;

    const input  = ctx.createGain();
    const output = ctx.createGain();
    const dry    = ctx.createGain();
    const wet    = ctx.createGain();
    const fx = { type: data.type, params: P, input, output, data, ctx, nodes: [] };

    /* バイパス処理: on=false なら input→output 直結 */
    if (data.on === false) {
      input.connect(output);
      fx.bypassed = true;
      fx.setParam = () => {};
      return fx;
    }

    dry.connect(output); wet.connect(output);

    const lfoOsc = (rate, shape) => {
      const o = ctx.createOscillator();
      o.type = shape || 'sine'; o.frequency.value = rate;
      try { o.start(); } catch (e) {}
      fx.nodes.push(o);
      return o;
    };

    switch (data.type) {
      case 'comp': {
        const c = ctx.createDynamicsCompressor();
        c.threshold.value = P.threshold; c.ratio.value = P.ratio;
        c.attack.value = P.attack; c.release.value = P.release; c.knee.value = P.knee;
        const mk = ctx.createGain(); mk.gain.value = P.makeup;
        input.connect(c); c.connect(mk); mk.connect(output);
        fx.comp = c; fx.mk = mk;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'makeup') mk.gain.value = v;
          else if (c[k]) c[k].value = v;
        };
        break;
      }
      case 'dist': {
        const sh = ctx.createWaveShaper();
        sh.curve = driveCurve(P.drive); sh.oversample = '4x';
        const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = P.tone;
        const og = ctx.createGain(); og.gain.value = P.out;
        input.connect(sh); sh.connect(tone); tone.connect(og); og.connect(wet);
        input.connect(dry);
        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'drive') sh.curve = driveCurve(v);
          else if (k === 'tone') tone.frequency.value = v;
          else if (k === 'out') og.gain.value = v;
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v; }
        };
        break;
      }
      case 'chorus': {
        input.connect(dry);
        const lfo = lfoOsc(P.rate);
        const voices = [];
        for (let i = 0; i < 2; i++) {
          const d = ctx.createDelay(0.1);
          d.delayTime.value = P.delay * (1 + i * 0.35);
          const dg = ctx.createGain(); dg.gain.value = P.depth;
          const ph = ctx.createGain(); ph.gain.value = i === 0 ? 1 : -1;
          lfo.connect(ph); ph.connect(dg); dg.connect(d.delayTime);
          const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
          input.connect(d);
          if (pan) { pan.pan.value = (i === 0 ? -1 : 1) * P.spread; d.connect(pan); pan.connect(wet); }
          else d.connect(wet);
          voices.push({ d, dg, pan });
        }
        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix * 0.35;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'rate') lfo.frequency.value = v;
          else if (k === 'depth') voices.forEach(x => x.dg.gain.value = v);
          else if (k === 'delay') voices.forEach((x, i) => x.d.delayTime.value = v * (1 + i * 0.35));
          else if (k === 'spread') voices.forEach((x, i) => { if (x.pan) x.pan.pan.value = (i === 0 ? -1 : 1) * v; });
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v * 0.35; }
        };
        break;
      }
      case 'phaser': {
        input.connect(dry);
        const lfo = lfoOsc(P.rate);
        const depth = ctx.createGain(); depth.gain.value = P.depth;
        lfo.connect(depth);
        let node = input;
        const aps = [];
        const n = Math.max(2, Math.round(P.stages));
        for (let i = 0; i < n; i++) {
          const ap = ctx.createBiquadFilter();
          ap.type = 'allpass';
          ap.frequency.value = P.base * (1 + i * 0.35);
          ap.Q.value = 0.6;
          depth.connect(ap.frequency);
          node.connect(ap); node = ap; aps.push(ap);
        }
        const fb = ctx.createGain(); fb.gain.value = P.feedback;
        node.connect(fb); fb.connect(aps[0]);
        node.connect(wet);
        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix * 0.5;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'rate') lfo.frequency.value = v;
          else if (k === 'depth') depth.gain.value = v;
          else if (k === 'base') aps.forEach((a, i) => a.frequency.value = v * (1 + i * 0.35));
          else if (k === 'feedback') fb.gain.value = U.clamp(v, 0, .85);
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v * 0.5; }
        };
        break;
      }
      case 'autofilter': {
        const f = ctx.createBiquadFilter();
        f.type = P.type || 'lowpass'; f.frequency.value = P.base; f.Q.value = P.q;
        const lfo = lfoOsc(P.rate);
        const dg = ctx.createGain(); dg.gain.value = P.depth;
        lfo.connect(dg); dg.connect(f.frequency);
        input.connect(f); f.connect(wet); input.connect(dry);
        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'rate') lfo.frequency.value = v;
          else if (k === 'depth') dg.gain.value = v;
          else if (k === 'base') f.frequency.value = v;
          else if (k === 'q') f.Q.value = v;
          else if (k === 'type') f.type = v;
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v; }
        };
        break;
      }
      case 'tremolo': {
        const g = ctx.createGain(); g.gain.value = 1 - P.depth / 2;
        const lfo = lfoOsc(P.rate, P.shape);
        const dg = ctx.createGain(); dg.gain.value = P.depth / 2;
        lfo.connect(dg); dg.connect(g.gain);
        input.connect(g); g.connect(output);
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'rate') lfo.frequency.value = v;
          else if (k === 'depth') { dg.gain.value = v / 2; g.gain.value = 1 - v / 2; }
          else if (k === 'shape') lfo.type = v;
        };
        break;
      }
      case 'delay': {
        const d = ctx.createDelay(2); d.delayTime.value = P.time;
        const fb = ctx.createGain(); fb.gain.value = P.feedback;
        const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = P.tone;
        input.connect(dry);
        input.connect(d); d.connect(tone); tone.connect(fb); fb.connect(d);
        d.connect(wet);
        wet.gain.value = P.mix; dry.gain.value = 1;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'time') d.delayTime.setTargetAtTime(v, ctx.currentTime, .03);
          else if (k === 'feedback') fb.gain.value = U.clamp(v, 0, .88);
          else if (k === 'tone') tone.frequency.value = v;
          else if (k === 'mix') wet.gain.value = v;
        };
        break;
      }
      case 'bitcrush': {
        const sh = ctx.createWaveShaper();
        sh.curve = bitCurve(P.bits);
        const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = P.tone;
        input.connect(sh); sh.connect(tone); tone.connect(wet);
        input.connect(dry);
        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix;
        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'bits') sh.curve = bitCurve(v);
          else if (k === 'tone') tone.frequency.value = v;
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v; }
        };
        break;
      }

      /* ══════════════ アナログディレイ (テープ / BBD) ══════════════
         ・ワウ / フラッター (2 系統の LFO によるディレイタイム揺れ)
         ・フィードバック経路にテープ飽和と帯域制限
         ・繰り返すたびに暗く歪んでいく = アナログらしい減衰
         ・ピンポン (L→R→L) 対応・テンポ同期対応                     */
      case 'analogdelay': {
        const spb = 60 / (Project.data ? Project.data.tempo : 120);
        const baseTime = P.sync ? U.clamp(spb * P.division, 0.02, 2.4) : P.time;

        const dl = ctx.createDelay(3), dr = ctx.createDelay(3);
        dl.delayTime.value = baseTime;
        dr.delayTime.value = baseTime * (P.pingpong ? 1 : 1.0);

        /* ワウ (ゆっくり) + フラッター (速い) */
        const wowLfo = lfoOsc(0.27 + Math.random() * 0.08);
        const fltLfo = lfoOsc(5.6 + Math.random() * 1.2);
        const wowG = ctx.createGain(); wowG.gain.value = P.wow * 0.0035;
        const fltG = ctx.createGain(); fltG.gain.value = P.flutter * 0.00045;
        wowLfo.connect(wowG); fltLfo.connect(fltG);
        wowG.connect(dl.delayTime); fltG.connect(dl.delayTime);
        const wowG2 = ctx.createGain(); wowG2.gain.value = -P.wow * 0.0031;
        wowLfo.connect(wowG2); wowG2.connect(dr.delayTime);

        /* フィードバック経路: 飽和 → ローパス → ハイパス */
        const sat = ctx.createWaveShaper();
        sat.curve = tapeCurve(P.drive); sat.oversample = '2x';
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
        lp.frequency.value = P.tone; lp.Q.value = 0.6;
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass';
        hp.frequency.value = P.lowcut; hp.Q.value = 0.6;
        const fb = ctx.createGain(); fb.gain.value = U.clamp(P.feedback, 0, 0.92);

        input.connect(dry);
        input.connect(dl);
        if (P.pingpong) {
          /* L → R → 飽和/帯域制限 → L へ戻す */
          dl.connect(dr);
          dr.connect(sat);
        } else {
          input.connect(dr);
          dl.connect(sat);
        }
        sat.connect(lp); lp.connect(hp); hp.connect(fb);
        fb.connect(dl);

        const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const tapTrim = ctx.createGain(); tapTrim.gain.value = 0.6;
        if (panL) {
          panL.pan.value = -P.spread; panR.pan.value = P.spread;
          dl.connect(panL); dr.connect(panR);
          panL.connect(tapTrim); panR.connect(tapTrim);
        } else { dl.connect(tapTrim); dr.connect(tapTrim); }
        tapTrim.connect(wet);

        wet.gain.value = P.mix; dry.gain.value = 1;
        fx.setParam = (k, v) => {
          P[k] = v;
          const t = ctx.currentTime;
          if (k === 'time' || k === 'division' || k === 'sync') {
            const nt = P.sync ? U.clamp((60 / Project.data.tempo) * P.division, 0.02, 2.4) : P.time;
            dl.delayTime.setTargetAtTime(nt, t, 0.05);
            dr.delayTime.setTargetAtTime(nt, t, 0.05);
          } else if (k === 'feedback') fb.gain.setTargetAtTime(U.clamp(v, 0, 0.92), t, 0.02);
          else if (k === 'tone') lp.frequency.setTargetAtTime(v, t, 0.02);
          else if (k === 'lowcut') hp.frequency.setTargetAtTime(v, t, 0.02);
          else if (k === 'drive') sat.curve = tapeCurve(v);
          else if (k === 'wow') { wowG.gain.value = v * 0.0035; wowG2.gain.value = -v * 0.0031; }
          else if (k === 'flutter') fltG.gain.value = v * 0.00045;
          else if (k === 'spread' && panL) { panL.pan.value = -v; panR.pan.value = v; }
          else if (k === 'mix') wet.gain.value = v;
        };
        break;
      }

      /* ══════════════ アナログリバーブ (プレート / スプリング) ══════════════
         畳み込みではなく FDN (フィードバック遅延ネットワーク) 方式。
         入力 → プリディレイ → 4 段オールパス拡散 → 4 ライン FDN
         (ハウスホルダー行列で相互帰還・LFO でディレイ長を微変調)
         → ダンピング → ステレオ出力。IR を持たないので軽く、
         パラメータを動かすと本物のアナログ機のように連続変化する。   */
      case 'analogverb': {
        const spring = (P.mode === 'spring');
        input.connect(dry);

        const pre = ctx.createDelay(0.5);
        pre.delayTime.value = P.predelay / 1000;
        const inHp = ctx.createBiquadFilter(); inHp.type = 'highpass';
        inHp.frequency.value = P.lowcut;
        const inDrive = ctx.createWaveShaper();
        inDrive.curve = tapeCurve(P.drive * 0.7); inDrive.oversample = '2x';
        input.connect(pre); pre.connect(inHp); inHp.connect(inDrive);

        /* 拡散器 (スプリングはより長く分散させる) */
        const apTimes = spring ? [0.0047, 0.0093, 0.0181, 0.0339, 0.0521]
                               : [0.0043, 0.0071, 0.0113, 0.0193];
        let node = inDrive;
        const aps = [];
        apTimes.forEach((t, i) => {
          const ap = makeAllpass(ctx, t * (0.6 + P.size * 0.9), P.diffusion * (i < 2 ? 1 : 0.86), 0.3);
          node.connect(ap.input); node = ap.output; aps.push(ap);
        });

        /* 4 ライン FDN */
        const N = 4;
        const baseLens = spring ? [0.0297, 0.0371, 0.0411, 0.0437]
                                : [0.0297, 0.0419, 0.0561, 0.0687];
        const lines = [], sumAll = ctx.createGain();
        sumAll.gain.value = 2 / N;                      /* ハウスホルダー行列 */
        const modLfo = [];
        for (let i = 0; i < N; i++) {
          const d = ctx.createDelay(1.2);
          const len = baseLens[i] * (0.35 + P.size * 1.75);
          d.delayTime.value = len;
          const damp = ctx.createBiquadFilter();
          damp.type = 'lowpass'; damp.frequency.value = P.damp; damp.Q.value = 0.5;
          const g = ctx.createGain();
          g.gain.value = U.clamp(P.decay, 0, 0.96);
          const fbNode = ctx.createGain();
          const neg = ctx.createGain(); neg.gain.value = -1;

          /* fb_i = (2/N)·Σd - d_i */
          sumAll.connect(fbNode);
          d.connect(neg); neg.connect(fbNode);
          fbNode.connect(damp); damp.connect(g); g.connect(d);
          node.connect(d);
          d.connect(sumAll);

          /* 微変調 (アナログの揺らぎ) */
          const lfo = lfoOsc(0.09 + i * 0.037 + Math.random() * 0.02);
          const lg = ctx.createGain();
          lg.gain.value = P.modulation * (spring ? 0.0018 : 0.0009) * (i % 2 ? 1 : -1);
          lfo.connect(lg); lg.connect(d.delayTime);
          modLfo.push(lg);
          lines.push({ d, damp, g });
        }

        /* ステレオ出力 (L = line0+2, R = line1+3) */
        const sumL = ctx.createGain(), sumR = ctx.createGain();
        /* FDN は 4 ライン分が加算されるため、出力を絞ってレベルを揃える */
        sumL.gain.value = sumR.gain.value = 0.22;
        lines[0].d.connect(sumL); lines[2].d.connect(sumL);
        lines[1].d.connect(sumR); lines[3].d.connect(sumR);
        const panL = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        const panR = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        if (panL) {
          panL.pan.value = -U.clamp(P.width, 0, 1); panR.pan.value = U.clamp(P.width, 0, 1);
          sumL.connect(panL); sumR.connect(panR);
          panL.connect(wet); panR.connect(wet);
        } else { sumL.connect(wet); sumR.connect(wet); }

        /* スプリング特有の「ボヨン」= 高域を持ち上げた分散 */
        if (spring) {
          const twang = ctx.createBiquadFilter();
          twang.type = 'peaking'; twang.frequency.value = 2600; twang.Q.value = 1.6; twang.gain.value = 5;
          wet.disconnect();
          wet.connect(twang); twang.connect(output);
        }

        wet.gain.value = P.mix; dry.gain.value = 1 - P.mix * 0.28;
        fx.setParam = (k, v) => {
          P[k] = v;
          const t = ctx.currentTime;
          if (k === 'decay') lines.forEach(l => l.g.gain.setTargetAtTime(U.clamp(v, 0, 0.96), t, 0.05));
          else if (k === 'damp') lines.forEach(l => l.damp.frequency.setTargetAtTime(v, t, 0.05));
          else if (k === 'predelay') pre.delayTime.setTargetAtTime(v / 1000, t, 0.03);
          else if (k === 'lowcut') inHp.frequency.setTargetAtTime(v, t, 0.03);
          else if (k === 'drive') inDrive.curve = tapeCurve(v * 0.7);
          else if (k === 'modulation') modLfo.forEach((g, i) => g.gain.value = v * 0.0012 * (i % 2 ? 1 : -1));
          else if (k === 'width' && panL) { panL.pan.value = -U.clamp(v, 0, 1); panR.pan.value = U.clamp(v, 0, 1); }
          else if (k === 'mix') { wet.gain.value = v; dry.gain.value = 1 - v * 0.28; }
          else if (k === 'size') {
            lines.forEach((l, i) => l.d.delayTime.setTargetAtTime(baseLens[i] * (0.35 + v * 1.75), t, 0.08));
            aps.forEach((ap, i) => ap.delay.delayTime.setTargetAtTime(apTimes[i] * (0.6 + v * 0.9), t, 0.08));
          } else if (k === 'diffusion') {
            aps.forEach((ap, i) => {
              const g2 = v * (i < 2 ? 1 : 0.86);
              ap.fb.gain.value = g2; ap.ff.gain.value = -g2;
            });
          }
        };
        break;
      }


      /* ══════════════ ギターアンプ (1970年代ハードロック) ══════════════
         入力 → ブライト回路 → 3段プリアンプ真空管 → トーンスタック
         → プレゼンス → パワー管サチュレーション (サグ付き)
         → 4x12 キャビネットシミュレーション                          */
      case 'guitaramp': {
        const inGain = ctx.createGain();
        inGain.gain.value = 0.4 + P.gain * 5.5;

        /* ブライト回路 (小音量時に高域を持ち上げる) */
        const bright = ctx.createBiquadFilter();
        bright.type = 'highshelf'; bright.frequency.value = 2200;
        bright.gain.value = P.bright ? 6 * (1 - P.gain * 0.55) : 0;

        /* プリアンプ段 (段間にカップリングコンデンサ相当のハイパス) */
        const st1 = ctx.createWaveShaper(); st1.curve = tubeCurve(P.gain * 0.75, 0.58); st1.oversample = '4x';
        const cp1 = ctx.createBiquadFilter(); cp1.type = 'highpass'; cp1.frequency.value = 90;
        const st2 = ctx.createWaveShaper(); st2.curve = tubeCurve(P.gain * 0.9, 0.7); st2.oversample = '4x';
        const cp2 = ctx.createBiquadFilter(); cp2.type = 'highpass'; cp2.frequency.value = 130;
        const st3 = ctx.createWaveShaper(); st3.curve = tubeCurve(P.gain * 0.55, 0.85); st3.oversample = '4x';

        /* トーンスタック (Marshall 系: ミッドを引くとドンシャリ) */
        const tBass = ctx.createBiquadFilter(); tBass.type = 'lowshelf';
        tBass.frequency.value = 180; tBass.gain.value = -12 + P.bass * 26;
        const tMid = ctx.createBiquadFilter(); tMid.type = 'peaking';
        tMid.frequency.value = 620; tMid.Q.value = 0.85; tMid.gain.value = -14 + P.mid * 24;
        const tTreb = ctx.createBiquadFilter(); tTreb.type = 'highshelf';
        tTreb.frequency.value = 2600; tTreb.gain.value = -12 + P.treble * 24;
        const pres = ctx.createBiquadFilter(); pres.type = 'peaking';
        pres.frequency.value = 4200; pres.Q.value = 1.1; pres.gain.value = -3 + P.presence * 12;

        /* パワーアンプ (サグ = 電源電圧降下による圧縮) */
        const sagComp = ctx.createDynamicsCompressor();
        sagComp.threshold.value = -20 + (1 - P.sag) * 16;
        sagComp.ratio.value = 2 + P.sag * 6;
        sagComp.attack.value = 0.004 + P.sag * 0.02;
        sagComp.release.value = 0.09 + P.sag * 0.22;
        sagComp.knee.value = 12;
        const power = ctx.createWaveShaper();
        power.curve = tubeCurve(0.18 + P.master * 0.7, 0.9); power.oversample = '4x';

        const cab = buildCabinet(ctx, P.cab);
        const outG = ctx.createGain(); outG.gain.value = P.out * 0.5;

        input.connect(inGain);
        inGain.connect(bright); bright.connect(st1);
        st1.connect(cp1); cp1.connect(st2);
        st2.connect(cp2); cp2.connect(st3);
        st3.connect(tBass); tBass.connect(tMid); tMid.connect(tTreb); tTreb.connect(pres);
        pres.connect(sagComp); sagComp.connect(power);
        power.connect(cab.input); cab.output.connect(outG);
        outG.connect(output);

        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'gain') {
            inGain.gain.value = 0.4 + v * 5.5;
            st1.curve = tubeCurve(v * 0.75, 0.58);
            st2.curve = tubeCurve(v * 0.9, 0.7);
            st3.curve = tubeCurve(v * 0.55, 0.85);
            bright.gain.value = P.bright ? 6 * (1 - v * 0.55) : 0;
          }
          else if (k === 'bass') tBass.gain.value = -12 + v * 26;
          else if (k === 'mid') tMid.gain.value = -14 + v * 24;
          else if (k === 'treble') tTreb.gain.value = -12 + v * 24;
          else if (k === 'presence') pres.gain.value = -3 + v * 12;
          else if (k === 'master') power.curve = tubeCurve(0.18 + v * 0.7, 0.9);
          else if (k === 'sag') {
            sagComp.threshold.value = -20 + (1 - v) * 16;
            sagComp.ratio.value = 2 + v * 6;
            sagComp.release.value = 0.09 + v * 0.22;
          }
          else if (k === 'out') outG.gain.value = v * 0.5;
        };
        break;
      }

      /* ══════════════ ベースアンプ (1970年代ロック) ══════════════
         クリーン経路と歪み経路をブレンドする定番の構成。
         低域はクリーンを残し、中高域に真空管の歪みを重ねる。        */
      case 'bassamp': {
        const inGain = ctx.createGain(); inGain.gain.value = 0.6 + P.gain * 3.4;

        /* クリーン経路 */
        const clean = ctx.createGain(); clean.gain.value = 1 - P.blend;
        /* 歪み経路 (低域を削ってから歪ませ、ブーミーさを避ける) */
        const dirtHp = ctx.createBiquadFilter(); dirtHp.type = 'highpass'; dirtHp.frequency.value = 140;
        const dirt1 = ctx.createWaveShaper(); dirt1.curve = tubeCurve(0.3 + P.gain * 0.7, 0.6); dirt1.oversample = '4x';
        const dirt2 = ctx.createWaveShaper(); dirt2.curve = tubeCurve(P.gain * 0.5, 0.8); dirt2.oversample = '2x';
        const dirtG = ctx.createGain(); dirtG.gain.value = P.blend * 0.85;

        /* 4 バンド EQ */
        const eB = ctx.createBiquadFilter(); eB.type = 'lowshelf';
        eB.frequency.value = 100; eB.gain.value = -12 + P.bass * 24;
        const eLM = ctx.createBiquadFilter(); eLM.type = 'peaking';
        eLM.frequency.value = 330; eLM.Q.value = 0.9; eLM.gain.value = -12 + P.lowmid * 24;
        const eHM = ctx.createBiquadFilter(); eHM.type = 'peaking';
        eHM.frequency.value = 1100; eHM.Q.value = 0.9; eHM.gain.value = -12 + P.himid * 24;
        const eT = ctx.createBiquadFilter(); eT.type = 'highshelf';
        eT.frequency.value = 3200; eT.gain.value = -12 + P.treble * 24;

        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -8 - P.comp * 22;
        comp.ratio.value = 2 + P.comp * 7;
        comp.attack.value = 0.008; comp.release.value = 0.14; comp.knee.value = 8;

        const cab = buildCabinet(ctx, P.cab);
        const outG = ctx.createGain(); outG.gain.value = P.out * 0.7;
        const mixSum = ctx.createGain();

        input.connect(inGain);
        inGain.connect(clean); clean.connect(mixSum);
        inGain.connect(dirtHp); dirtHp.connect(dirt1); dirt1.connect(dirt2);
        dirt2.connect(dirtG); dirtG.connect(mixSum);
        mixSum.connect(eB); eB.connect(eLM); eLM.connect(eHM); eHM.connect(eT);
        eT.connect(comp); comp.connect(cab.input);
        cab.output.connect(outG); outG.connect(output);

        fx.setParam = (k, v) => {
          P[k] = v;
          if (k === 'gain') {
            inGain.gain.value = 0.6 + v * 3.4;
            dirt1.curve = tubeCurve(0.3 + v * 0.7, 0.6);
            dirt2.curve = tubeCurve(v * 0.5, 0.8);
          }
          else if (k === 'blend') { clean.gain.value = 1 - v; dirtG.gain.value = v * 0.85; }
          else if (k === 'bass') eB.gain.value = -12 + v * 24;
          else if (k === 'lowmid') eLM.gain.value = -12 + v * 24;
          else if (k === 'himid') eHM.gain.value = -12 + v * 24;
          else if (k === 'treble') eT.gain.value = -12 + v * 24;
          else if (k === 'comp') { comp.threshold.value = -8 - v * 22; comp.ratio.value = 2 + v * 7; }
          else if (k === 'out') outG.gain.value = v * 0.7;
        };
        break;
      }

      case 'eq': {
        const bands = [];
        let node = input;
        for (let i = 1; i <= 3; i++) {
          const b = ctx.createBiquadFilter();
          b.type = 'peaking';
          b.frequency.value = P['f' + i]; b.gain.value = P['g' + i]; b.Q.value = P['q' + i];
          node.connect(b); node = b; bands.push(b);
        }
        node.connect(output);
        fx.setParam = (k, v) => {
          P[k] = v;
          const i = parseInt(k[1], 10) - 1;
          const b = bands[i]; if (!b) return;
          if (k[0] === 'f') b.frequency.value = v;
          else if (k[0] === 'g') b.gain.value = v;
          else if (k[0] === 'q') b.Q.value = v;
        };
        break;
      }
      default:
        input.connect(output);
        fx.setParam = () => {};
    }
    return fx;
  }
};

/* UI 用: セレクトで選ぶパラメータの定義 */
FX.CHOICES = {
  guitaramp: { cab: [{ v: '4x12', l: '4×12 スタック (ハードロック)' },
                     { v: '2x12', l: '2×12 コンボ' }, { v: '1x12', l: '1×12 ツイード' }],
               bright: [{ v: 1, l: 'ブライト ON' }, { v: 0, l: 'ブライト OFF' }] },
  bassamp:   { cab: [{ v: '8x10', l: '8×10 フリッジ' }, { v: '1x15', l: '1×15 ビンテージ' }] },
  analogverb: { mode: [{ v: 'plate', l: 'プレート' }, { v: 'spring', l: 'スプリング' }] },
  analogdelay: { sync: [{ v: 1, l: 'テンポ同期' }, { v: 0, l: 'フリー (秒)' }],
                 pingpong: [{ v: 1, l: 'ピンポン' }, { v: 0, l: 'ステレオ' }] },
  autofilter: { type: [{ v: 'lowpass', l: 'ローパス' }, { v: 'highpass', l: 'ハイパス' },
                       { v: 'bandpass', l: 'バンドパス' }, { v: 'notch', l: 'ノッチ' }] }
};

window.FX = FX;
window.makeAllpass = makeAllpass;
window.tapeCurve = tapeCurve;
window.tubeCurve = tubeCurve;
window.buildCabinet = buildCabinet;
