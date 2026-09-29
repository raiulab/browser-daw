/* ══════════════════════════════════════════════════════════════
   engine.js — オーディオエンジン / チャンネルストリップ / バス
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── インパルスレスポンス生成 (リバーブ用) ───────────────── */
function makeImpulse(ctx, seconds, decay, damp) {
  const rate = ctx.sampleRate;
  const len  = Math.max(1, Math.floor(rate * seconds));
  const buf  = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.pow(1 - t, decay);
      const n = (Math.random() * 2 - 1) * env;
      lp += (n - lp) * (damp == null ? 0.42 : damp);   // 高域減衰
      // 初期反射を少し混ぜる
      d[i] = lp * (i < rate * 0.012 ? 0.55 : 1);
    }
  }
  return buf;
}

/* ── マスター用ソフトクリップカーブ (0dBFS を超えさせない) ── */
function softClipCurve(ceiling) {
  const n = 4096, c = new Float32Array(n);
  const k = 1.9, norm = Math.tanh(k);
  const ceil = ceiling == null ? 0.985 : ceiling;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = (Math.tanh(k * x) / norm) * ceil;
  }
  return c;
}

/* ── ノイズバッファ (ドラム / ノイズOSC 用) ───────────────── */
const _noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = _noiseCache.get(ctx);
  if (b) return b;
  const len = Math.floor(ctx.sampleRate * 2);
  b = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  _noiseCache.set(ctx, b);
  return b;
}

/* ══════════════════ チャンネルストリップ ══════════════════ */
/* 信号: input → EQ(3band) → inserts… → panner → fader → (meter) → master
        fader → sendReverb / sendDelay → 各バス                        */
function createChannel(ctx, trackData, graph) {
  const c = {};
  c.input  = ctx.createGain();
  c.input.gain.value = 1;

  /* 3バンド EQ */
  c.eqLow  = ctx.createBiquadFilter(); c.eqLow.type  = 'lowshelf';  c.eqLow.frequency.value = 120;
  c.eqMid  = ctx.createBiquadFilter(); c.eqMid.type  = 'peaking';   c.eqMid.frequency.value = 1200; c.eqMid.Q.value = 0.9;
  c.eqHigh = ctx.createBiquadFilter(); c.eqHigh.type = 'highshelf'; c.eqHigh.frequency.value = 6000;
  c.hpf    = ctx.createBiquadFilter(); c.hpf.type    = 'highpass';  c.hpf.frequency.value = 20; c.hpf.Q.value = 0.7;

  c.input.connect(c.hpf);
  c.hpf.connect(c.eqLow);
  c.eqLow.connect(c.eqMid);
  c.eqMid.connect(c.eqHigh);

  /* インサートFX チェーン */
  c.inserts = [];
  let tail = c.eqHigh;
  (trackData.inserts || []).forEach(fxData => {
    const fx = FX.create(ctx, fxData);
    if (!fx) return;
    c.inserts.push(fx);
    tail.connect(fx.input);
    tail = fx.output;
  });

  c.panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  c.fader  = ctx.createGain();

  if (c.panner) { tail.connect(c.panner); c.panner.connect(c.fader); }
  else          { tail.connect(c.fader); }

  /* メーター (ライブ時のみ) */
  if (graph.live) {
    c.analyser = ctx.createAnalyser();
    c.analyser.fftSize = 512;
    c.analyser.smoothingTimeConstant = 0.2;
    c.meterBuf = new Float32Array(c.analyser.fftSize);
    c.fader.connect(c.analyser);
    c.analyser.connect(graph.masterIn);
  } else {
    c.fader.connect(graph.masterIn);
  }

  /* センド (ポストフェーダー) */
  c.sendRev = ctx.createGain(); c.sendRev.gain.value = 0;
  c.sendDly = ctx.createGain(); c.sendDly.gain.value = 0;
  c.fader.connect(c.sendRev); c.sendRev.connect(graph.reverbIn);
  c.fader.connect(c.sendDly); c.sendDly.connect(graph.delayIn);

  c.peak = 0; c.peakHold = 0;
  c.applyParams = function (t, soloActive) {
    const muted = t.mute || (soloActive && !t.solo);
    const g = muted ? 0 : t.volume;
    const now = ctx.currentTime;
    c.fader.gain.setTargetAtTime(g, now, 0.012);
    if (c.panner) c.panner.pan.setTargetAtTime(U.clamp(t.pan, -1, 1), now, 0.012);
    c.eqLow.gain.value  = t.eq.low;
    c.eqMid.gain.value  = t.eq.mid;
    c.eqMid.frequency.value = t.eq.midFreq || 1200;
    c.eqHigh.gain.value = t.eq.high;
    c.hpf.frequency.value = t.eq.hp || 20;
    c.sendRev.gain.setTargetAtTime(t.sends.reverb, now, 0.02);
    c.sendDly.gain.setTargetAtTime(t.sends.delay, now, 0.02);
  };
  return c;
}

/* ══════════════════ グラフ構築 (ライブ / オフライン共用) ══════════════════ */
function buildGraph(ctx, project, live) {
  const g = { ctx, live: !!live, channels: {}, instruments: {} };

  /* --- マスター --- */
  g.masterIn  = ctx.createGain();
  g.masterVol = ctx.createGain();
  g.masterVol.gain.value = project.masterVolume != null ? project.masterVolume : 0.85;

  /* マスターEQ + リミッター */
  const M = project.mastering || MASTERING_DEFAULTS;
  const LIM = (M.on ? M.limiter : MASTERING_DEFAULTS.limiter) || MASTERING_DEFAULTS.limiter;
  g.masterComp = ctx.createDynamicsCompressor();
  g.masterComp.threshold.value = LIM.threshold;
  g.masterComp.knee.value      = 2;
  g.masterComp.ratio.value     = LIM.ratio;
  g.masterComp.attack.value    = 0.002;
  g.masterComp.release.value   = LIM.release;

  /* マスタリングチェーン (サチュ→EQ→マルチバンド→ステレオ幅) */
  g.mastering = buildMasteringChain(ctx, M);

  /* 最終段のソフトクリッパー: これ以降 |x| は 0.985 を超えない */
  g.masterClip = ctx.createWaveShaper();
  g.masterClip.curve = softClipCurve(LIM.ceiling);
  g.masterClip.oversample = 'none';   /* 出力を必ず ±0.985 以内に収めるため */

  g.masterIn.connect(g.masterVol);
  g.masterVol.connect(g.mastering.input);
  g.mastering.output.connect(g.masterComp);
  g.masterComp.connect(g.masterClip);

  if (live) {
    g.masterAnalyserL = ctx.createAnalyser(); g.masterAnalyserL.fftSize = 1024;
    g.masterAnalyserR = ctx.createAnalyser(); g.masterAnalyserR.fftSize = 1024;
    g.splitter = ctx.createChannelSplitter(2);
    g.masterClip.connect(g.splitter);
    g.splitter.connect(g.masterAnalyserL, 0);
    g.splitter.connect(g.masterAnalyserR, 1);
    g.mBufL = new Float32Array(1024);
    g.mBufR = new Float32Array(1024);
    try { Loudness.attach(ctx, g.masterClip); } catch (e) {}
  }
  g.masterClip.connect(ctx.destination);

  /* --- リバーブバス --- */
  g.reverbIn  = ctx.createGain();
  g.reverbPre = ctx.createDelay(0.4);
  g.reverbPre.delayTime.value = (project.fxBus.reverb.preDelay || 20) / 1000;
  g.reverbConv = ctx.createConvolver();
  g.reverbConv.buffer = makeImpulse(ctx,
      project.fxBus.reverb.size || 2.2,
      project.fxBus.reverb.decay || 2.4,
      project.fxBus.reverb.damp || 0.42);
  g.reverbTone = ctx.createBiquadFilter();
  g.reverbTone.type = 'lowpass';
  g.reverbTone.frequency.value = project.fxBus.reverb.tone || 7000;
  g.reverbRet = ctx.createGain();
  g.reverbRet.gain.value = project.fxBus.reverb.level != null ? project.fxBus.reverb.level : 0.9;
  g.reverbIn.connect(g.reverbPre);
  g.reverbPre.connect(g.reverbConv);
  g.reverbConv.connect(g.reverbTone);
  g.reverbTone.connect(g.reverbRet);
  g.reverbRet.connect(g.masterIn);

  /* --- ディレイバス (ステレオ ピンポン) --- */
  const spb = 60 / project.tempo;
  g.delayIn = ctx.createGain();
  g.dlySplit = ctx.createChannelSplitter(2);
  g.dlyMerge = ctx.createChannelMerger(2);
  g.dlyL = ctx.createDelay(5); g.dlyR = ctx.createDelay(5);
  const dTime = spb * (project.fxBus.delay.division || 0.5);
  g.dlyL.delayTime.value = dTime;
  g.dlyR.delayTime.value = dTime * 1.5;
  g.dlyFb = ctx.createGain(); g.dlyFb.gain.value = project.fxBus.delay.feedback || 0.34;
  g.dlyTone = ctx.createBiquadFilter(); g.dlyTone.type = 'lowpass';
  g.dlyTone.frequency.value = project.fxBus.delay.tone || 4200;
  g.delayRet = ctx.createGain();
  g.delayRet.gain.value = project.fxBus.delay.level != null ? project.fxBus.delay.level : 0.85;

  g.delayIn.connect(g.dlyL);
  g.dlyL.connect(g.dlyR);
  g.dlyR.connect(g.dlyTone);
  g.dlyTone.connect(g.dlyFb);
  g.dlyFb.connect(g.dlyL);
  g.dlyL.connect(g.dlyMerge, 0, 0);
  g.dlyR.connect(g.dlyMerge, 0, 1);
  g.dlyMerge.connect(g.delayRet);
  g.delayRet.connect(g.masterIn);

  /* --- 各トラック --- */
  const soloActive = project.tracks.some(t => t.solo);
  project.tracks.forEach(t => {
    const ch = createChannel(ctx, t, g);
    g.channels[t.id] = ch;
    ch.applyParams(t, soloActive);
    /* オーディオトラックは音源を持たない (リージョンを直接チャンネルへ流す) */
    g.instruments[t.id] = (t.type === 'audio')
      ? null : Instruments.create(ctx, t.instrument, ch.input);
  });

  return g;
}

/* ══════════════════ Engine (ライブ) ══════════════════ */
const Engine = {
  ctx: null,
  graph: null,
  ready: false,
  cpuLoad: 0,

  /* ── オーディオ設定 (localStorage に保存) ── */
  prefs: {
    sampleRate: 48000,        /* 44100 / 48000 / 88200 / 96000 */
    lowLatency: true,         /* true = latencyHint 0 (最小バッファ) */
    exportRate: 48000,
    exportBits: 24
  },
  loadPrefs() {
    try {
      const s = localStorage.getItem('logicx.audioPrefs');
      if (s) Object.assign(this.prefs, JSON.parse(s));
    } catch (e) {}
    return this.prefs;
  },
  savePrefs() {
    try { localStorage.setItem('logicx.audioPrefs', JSON.stringify(this.prefs)); } catch (e) {}
  },

  init() {
    if (this.ctx) return this.ctx;
    this.loadPrefs();
    const AC = window.AudioContext || window.webkitAudioContext;
    /* latencyHint に数値 0 を渡すと、ブラウザは可能な限り小さい
       出力バッファ (通常 128 サンプル = 2.7ms @48k) を選択する。 */
    const opts = { latencyHint: this.prefs.lowLatency ? 0 : 'interactive' };
    if (this.prefs.sampleRate) opts.sampleRate = this.prefs.sampleRate;
    try {
      this.ctx = new AC(opts);
    } catch (e) {
      /* 指定サンプルレートが使えない環境ではデバイス既定にフォールバック */
      this.ctx = new AC({ latencyHint: this.prefs.lowLatency ? 0 : 'interactive' });
    }
    return this.ctx;
  },

  /* サンプルレート等を変更して作り直す */
  async reconfigure(prefs) {
    Object.assign(this.prefs, prefs);
    this.savePrefs();
    const wasPlaying = Transport.isPlaying();
    if (wasPlaying) Transport.stop();
    this.dispose();
    if (this.ctx) { try { await this.ctx.close(); } catch (e) {} }
    this.ctx = null;
    this.init();
    await this.resume();
    Instruments.prewarm(this.ctx);
    this.rebuild(Project.data);
    this.setMasterVolume(Project.data.masterVolume);
    return this.ctx.sampleRate;
  },

  async resume() {
    this.init();
    if (this.ctx.state !== 'running') {
      /* ユーザー操作が無い場合 resume() は解決しないままになることがあるため、
         必ずタイムアウトで先へ進めて初期化をブロックしない */
      try {
        await Promise.race([
          this.ctx.resume(),
          new Promise(r => setTimeout(r, 1200))
        ]);
      } catch (e) {}
    }
    return this.ctx.state === 'running';
  },

  /* プロジェクトからライブグラフを（再）構築 */
  rebuild(project) {
    this.init();
    if (this.graph) this.dispose();
    this.graph = buildGraph(this.ctx, project, true);
    this.ready = true;
  },

  dispose() {
    if (!this.graph) return;
    try {
      Object.values(this.graph.instruments).forEach(i => i && i.dispose && i.dispose());
      this.graph.masterComp.disconnect();
      this.graph.masterClip.disconnect();
      this.graph.masterIn.disconnect();
    } catch (e) {}
    this.graph = null;
  },

  channel(trackId) { return this.graph && this.graph.channels[trackId]; },

  /* 音源パラメータ変更時に、そのトラックの音源だけ作り直す */
  rebuildInstrument(trackId, instDef) {
    const ch = this.channel(trackId);
    if (!ch) return;
    const tr = Project.track(trackId);
    if (tr && tr.type === 'audio') return;
    const old = this.graph.instruments[trackId];
    if (old) { try { old.allOff(); old.dispose(); } catch (e) {} }
    this.graph.instruments[trackId] = Instruments.create(this.ctx, instDef, ch.input);
  },

  instrument(trackId) { return this.graph && this.graph.instruments[trackId]; },

  setMasterVolume(v) {
    if (this.graph) this.graph.masterVol.gain.setTargetAtTime(v, this.ctx.currentTime, 0.015);
  },

  applyMixParams(project) {
    if (!this.graph) return;
    const soloActive = project.tracks.some(t => t.solo);
    project.tracks.forEach(t => {
      const c = this.graph.channels[t.id];
      if (c) c.applyParams(t, soloActive);
    });
  },

  /* バス設定の反映 */
  applyBusParams(project) {
    if (!this.graph) return;
    const g = this.graph, r = project.fxBus.reverb, d = project.fxBus.delay;
    g.reverbPre.delayTime.value = r.preDelay / 1000;
    g.reverbTone.frequency.value = r.tone;
    g.reverbRet.gain.value = r.level;
    const spb = 60 / project.tempo;
    g.dlyL.delayTime.value = spb * d.division;
    g.dlyR.delayTime.value = spb * d.division * 1.5;
    g.dlyFb.gain.value = U.clamp(d.feedback, 0, 0.88);
    g.dlyTone.frequency.value = d.tone;
    g.delayRet.gain.value = d.level;
  },
  rebuildReverbIR(project) {
    if (!this.graph) return;
    const r = project.fxBus.reverb;
    this.graph.reverbConv.buffer = makeImpulse(this.ctx, r.size, r.decay, r.damp);
  },

  /* --- メーター読み取り (RMS + ピーク) --- */
  readMeter(ch) {
    if (!ch || !ch.analyser) return 0;
    ch.analyser.getFloatTimeDomainData(ch.meterBuf);
    let peak = 0, sum = 0;
    const b = ch.meterBuf;
    for (let i = 0; i < b.length; i++) {
      const a = Math.abs(b[i]);
      if (a > peak) peak = a;
      sum += b[i] * b[i];
    }
    const rms = Math.sqrt(sum / b.length);
    const lvl = Math.max(rms * 2.4, peak * 0.85);
    ch.peak = Math.max(lvl, ch.peak * 0.82);
    return U.clamp(ch.peak, 0, 1.4);
  },
  readMasterMeter() {
    const g = this.graph;
    if (!g || !g.masterAnalyserL) return [0, 0];
    const calc = (an, buf) => {
      an.getFloatTimeDomainData(buf);
      let s = 0, p = 0;
      for (let i = 0; i < buf.length; i++) { s += buf[i] * buf[i]; const a = Math.abs(buf[i]); if (a > p) p = a; }
      return Math.max(Math.sqrt(s / buf.length) * 2.4, p * 0.85);
    };
    return [calc(g.masterAnalyserL, g.mBufL), calc(g.masterAnalyserR, g.mBufR)];
  },

  /* メトロノーム クリック */
  click(time, accent) {
    const ctx = this.ctx;
    if (!ctx || !this.graph) return;
    const o = ctx.createOscillator();
    const gn = ctx.createGain();
    o.type = 'square';
    o.frequency.value = accent ? 1600 : 1050;
    gn.gain.setValueAtTime(0, time);
    gn.gain.linearRampToValueAtTime(accent ? 0.34 : 0.2, time + 0.001);
    gn.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);
    o.connect(gn); gn.connect(this.graph.masterVol);
    o.start(time); o.stop(time + 0.06);
  }
};

window.Engine = Engine;
window.buildGraph = buildGraph;
window.makeImpulse = makeImpulse;
window.noiseBuffer = noiseBuffer;
