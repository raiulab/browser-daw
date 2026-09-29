/* ══════════════════════════════════════════════════════════════
   mastering.js — マスタリングチェーン + ラウドネス計測 + 専用パネル

   信号: masterVol → サチュレーション → マスターEQ(4band)
                   → マルチバンドコンプ(3band) → ステレオ幅(M/S)
                   → リミッター → ソフトクリップ → 出力
   ══════════════════════════════════════════════════════════════ */
'use strict';

const MASTERING_DEFAULTS = {
  on: true,
  preset: 'ストリーミング配信',
  sat:  { on: false, amount: 0.18 },
  eq:   { lowGain: 0, lowFreq: 90, p1Gain: 0, p1Freq: 350, p1Q: 0.9,
          p2Gain: 0, p2Freq: 3000, p2Q: 0.9, highGain: 0, highFreq: 8000 },
  mb:   { on: false, xLow: 220, xHigh: 2800,
          bands: [ { th: -22, ratio: 2.4, att: 0.02,  rel: 0.22, makeup: 1.2 },
                   { th: -20, ratio: 2.0, att: 0.012, rel: 0.16, makeup: 1.15 },
                   { th: -18, ratio: 2.2, att: 0.005, rel: 0.10, makeup: 1.1 } ] },
  width: 1.0,
  limiter: { threshold: -1.5, ratio: 18, release: 0.14, ceiling: 0.985 }
};

const MASTERING_PRESETS = {
  'オフ (フラット)': { on: false },
  'ストリーミング配信': {
    on: true, sat: { on: true, amount: 0.14 },
    eq: { lowGain: 0.5, lowFreq: 90, p1Gain: -0.8, p1Freq: 320, p1Q: 1.0,
          p2Gain: 0.8, p2Freq: 3200, p2Q: 0.8, highGain: 1.2, highFreq: 9000 },
    mb: { on: true, xLow: 220, xHigh: 2800 },
    width: 1.08, limiter: { threshold: -1.2, ratio: 18, release: 0.16, ceiling: 0.985 }
  },
  'クラブ / EDM (大音量)': {
    on: true, sat: { on: true, amount: 0.3 },
    eq: { lowGain: 2.0, lowFreq: 70, p1Gain: -1.5, p1Freq: 380, p1Q: 1.1,
          p2Gain: 1.2, p2Freq: 4200, p2Q: 0.8, highGain: 1.8, highFreq: 10000 },
    mb: { on: true, xLow: 180, xHigh: 3200 },
    width: 1.18, limiter: { threshold: -0.8, ratio: 20, release: 0.09, ceiling: 0.99 }
  },
  '放送 / ナレーション (-23 LUFS)': {
    on: true, sat: { on: false, amount: 0 },
    eq: { lowGain: -1.5, lowFreq: 110, p1Gain: 0.6, p1Freq: 900, p1Q: 0.8,
          p2Gain: 1.0, p2Freq: 3600, p2Q: 1.0, highGain: 0, highFreq: 9000 },
    mb: { on: true, xLow: 250, xHigh: 2600 },
    width: 1.0, limiter: { threshold: -6, ratio: 12, release: 0.24, ceiling: 0.9 }
  },
  'アコースティック (自然)': {
    on: true, sat: { on: false, amount: 0 },
    eq: { lowGain: 0.4, lowFreq: 85, p1Gain: -0.6, p1Freq: 280, p1Q: 1.2,
          p2Gain: 0.6, p2Freq: 5200, p2Q: 0.7, highGain: 0.8, highFreq: 11000 },
    mb: { on: false, xLow: 220, xHigh: 2800 },
    width: 1.05, limiter: { threshold: -3, ratio: 10, release: 0.22, ceiling: 0.97 }
  }
};

/* ══════════════ チェーン構築 ══════════════ */
function buildMasteringChain(ctx, M) {
  const chain = { input: ctx.createGain(), output: ctx.createGain(), nodes: {} };
  if (!M || !M.on) { chain.input.connect(chain.output); chain.bypass = true; return chain; }

  let node = chain.input;

  /* ── サチュレーション ── */
  if (M.sat.on && M.sat.amount > 0.005) {
    const sh = ctx.createWaveShaper();
    sh.curve = driveCurve(M.sat.amount * 0.55);
    sh.oversample = '4x';
    const comp = ctx.createGain(); comp.gain.value = 1 / (1 + M.sat.amount * 0.5);
    node.connect(sh); sh.connect(comp); node = comp;
    chain.nodes.sat = sh;
  }

  /* ── マスター EQ (4 バンド) ── */
  const eq = M.eq;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf';
  low.frequency.value = eq.lowFreq; low.gain.value = eq.lowGain;
  const p1 = ctx.createBiquadFilter(); p1.type = 'peaking';
  p1.frequency.value = eq.p1Freq; p1.gain.value = eq.p1Gain; p1.Q.value = eq.p1Q;
  const p2 = ctx.createBiquadFilter(); p2.type = 'peaking';
  p2.frequency.value = eq.p2Freq; p2.gain.value = eq.p2Gain; p2.Q.value = eq.p2Q;
  const high = ctx.createBiquadFilter(); high.type = 'highshelf';
  high.frequency.value = eq.highFreq; high.gain.value = eq.highGain;
  node.connect(low); low.connect(p1); p1.connect(p2); p2.connect(high);
  node = high;
  chain.nodes.eq = { low, p1, p2, high };

  /* ── マルチバンドコンプレッサー (3 バンド) ── */
  if (M.mb.on) {
    const sum = ctx.createGain();
    const mk2 = (type, freq) => {
      const a = ctx.createBiquadFilter(), b = ctx.createBiquadFilter();
      a.type = b.type = type; a.frequency.value = b.frequency.value = freq;
      a.Q.value = b.Q.value = 0.7071;
      a.connect(b);
      return { inp: a, out: b };
    };
    const comps = [];
    const mkBand = (chainNodes, cfg) => {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = cfg.th; c.ratio.value = cfg.ratio;
      c.attack.value = cfg.att; c.release.value = cfg.rel; c.knee.value = 6;
      const g = ctx.createGain(); g.gain.value = cfg.makeup;
      chainNodes.out.connect(c); c.connect(g); g.connect(sum);
      node.connect(chainNodes.inp);
      comps.push(c);
      return c;
    };
    const lowB = mk2('lowpass', M.mb.xLow);
    const midHP = mk2('highpass', M.mb.xLow);
    const midLP = mk2('lowpass', M.mb.xHigh);
    midHP.out.connect(midLP.inp);
    const highB = mk2('highpass', M.mb.xHigh);

    const bands = M.mb.bands || MASTERING_DEFAULTS.mb.bands;
    mkBand(lowB, bands[0]);
    mkBand({ inp: midHP.inp, out: midLP.out }, bands[1]);
    mkBand(highB, bands[2]);
    node = sum;
    chain.nodes.mbComps = comps;
  }

  /* ── ステレオ幅 (M/S 処理) ── */
  if (Math.abs(M.width - 1) > 0.005 && ctx.createChannelSplitter) {
    const sp = ctx.createChannelSplitter(2);
    const mg = ctx.createChannelMerger(2);
    const midL = ctx.createGain(), midR = ctx.createGain();
    const sideL = ctx.createGain(), sideR = ctx.createGain();
    midL.gain.value = 0.5; midR.gain.value = 0.5;
    sideL.gain.value = 0.5 * M.width; sideR.gain.value = -0.5 * M.width;
    const mid = ctx.createGain(), side = ctx.createGain();
    node.connect(sp);
    sp.connect(midL, 0); sp.connect(midR, 1);
    sp.connect(sideL, 0); sp.connect(sideR, 1);
    midL.connect(mid); midR.connect(mid);
    sideL.connect(side); sideR.connect(side);
    /* L = M + S,  R = M - S */
    const sideNeg = ctx.createGain(); sideNeg.gain.value = -1;
    side.connect(sideNeg);
    mid.connect(mg, 0, 0); side.connect(mg, 0, 0);
    mid.connect(mg, 0, 1); sideNeg.connect(mg, 0, 1);
    node = mg;
    chain.nodes.width = { sideL, sideR };
  }

  node.connect(chain.output);
  return chain;
}

/* ══════════════ ラウドネス計測 (ITU-R BS.1770 近似) ══════════════ */
const Loudness = {
  analyser: null, buf: null,
  msRing: [], ringMax: 0,
  momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity,
  peak: 0, truePeak: 0, correlation: 0,
  _intSum: 0, _intCount: 0,
  _corrA: null, _corrB: null, _spl: null,

  attach(ctx, sourceNode) {
    /* K ウェイティング: ハイシェルフ +4dB(1.5k) → ハイパス 38Hz */
    const hs = ctx.createBiquadFilter();
    hs.type = 'highshelf'; hs.frequency.value = 1500; hs.gain.value = 4;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 38; hp.Q.value = 0.5;
    const an = ctx.createAnalyser(); an.fftSize = 2048;
    sourceNode.connect(hs); hs.connect(hp); hp.connect(an);
    this.analyser = an;
    this.buf = new Float32Array(an.fftSize);

    /* 相関計測用に L / R を分離 */
    const sp = ctx.createChannelSplitter(2);
    const aL = ctx.createAnalyser(); aL.fftSize = 1024;
    const aR = ctx.createAnalyser(); aR.fftSize = 1024;
    sourceNode.connect(sp);
    sp.connect(aL, 0); sp.connect(aR, 1);
    this._corrA = aL; this._corrB = aR;
    this._bufL = new Float32Array(1024);
    this._bufR = new Float32Array(1024);

    this.reset();
  },
  reset() {
    this.msRing = []; this._intSum = 0; this._intCount = 0;
    this.momentary = this.shortTerm = this.integrated = -Infinity;
    this.peak = this.truePeak = 0;
  },

  update() {
    const an = this.analyser;
    if (!an) return;
    an.getFloatTimeDomainData(this.buf);
    const b = this.buf;
    let ms = 0, pk = 0;
    for (let i = 0; i < b.length; i++) { ms += b[i] * b[i]; const a = Math.abs(b[i]); if (a > pk) pk = a; }
    ms /= b.length;

    const sr = Engine.ctx ? Engine.ctx.sampleRate : 48000;
    const blockSec = b.length / sr;
    this.msRing.push({ ms, t: blockSec });
    /* 3 秒ぶんだけ保持 */
    let acc = 0;
    for (let i = this.msRing.length - 1; i >= 0; i--) {
      acc += this.msRing[i].t;
      if (acc > 3.2) { this.msRing.splice(0, i); break; }
    }

    const meanOver = sec => {
      let s = 0, t = 0;
      for (let i = this.msRing.length - 1; i >= 0 && t < sec; i--) { s += this.msRing[i].ms; t += this.msRing[i].t; }
      const n = Math.max(1, Math.round(t / blockSec));
      return s / n;
    };
    const toLufs = m => (m > 1e-12 ? -0.691 + 10 * Math.log10(m * 2) : -Infinity);

    this.momentary = toLufs(meanOver(0.4));
    this.shortTerm = toLufs(meanOver(3.0));

    /* 積分ラウドネス: -70 LUFS の絶対ゲート */
    if (toLufs(ms) > -70) { this._intSum += ms; this._intCount++; }
    this.integrated = this._intCount ? toLufs(this._intSum / this._intCount) : -Infinity;

    /* ピーク (マスター出力から) */
    const g = Engine.graph;
    if (g && g.masterAnalyserL) {
      const l = g.mBufL, r = g.mBufR;
      g.masterAnalyserL.getFloatTimeDomainData(l);
      g.masterAnalyserR.getFloatTimeDomainData(r);
      let p = 0;
      for (let i = 0; i < l.length; i++) {
        const a = Math.abs(l[i]), c = Math.abs(r[i]);
        if (a > p) p = a; if (c > p) p = c;
      }
      this.peak = Math.max(p, this.peak * 0.97);
      this.truePeak = Math.max(this.truePeak, p);
    }

    /* ステレオ相関 */
    if (this._corrA) {
      this._corrA.getFloatTimeDomainData(this._bufL);
      this._corrB.getFloatTimeDomainData(this._bufR);
      let num = 0, dl = 0, dr = 0;
      for (let i = 0; i < this._bufL.length; i++) {
        num += this._bufL[i] * this._bufR[i];
        dl += this._bufL[i] * this._bufL[i];
        dr += this._bufR[i] * this._bufR[i];
      }
      const d = Math.sqrt(dl * dr);
      const c = d > 1e-9 ? num / d : 0;
      this.correlation = this.correlation * 0.85 + c * 0.15;
    }
  },
  gainReduction() {
    const g = Engine.graph;
    return g && g.masterComp ? g.masterComp.reduction : 0;
  }
};

/* ══════════════ マスタリングパネル ══════════════ */
const MasteringUI = {
  win: null, _raf: null,

  isOpen() { return !!this.win; },
  toggle() { this.win ? this.close() : this.open(); },

  open() {
    this.close();
    const M = Project.data.mastering;
    const win = U.el('div', 'mst-win');
    this.win = win;
    win.style.left = Math.max(10, window.innerWidth - 700) + 'px';
    win.style.top = '92px';

    const head = U.el('div', 'mst-head');
    head.innerHTML = '<span class="mst-mark">◎</span><span class="mst-name">MASTERING</span>';
    const psel = U.el('select', 'spx-preset-sel');
    Object.keys(MASTERING_PRESETS).forEach(n => {
      const o = U.el('option', null, n); o.value = n;
      if (M.preset === n) o.selected = true; psel.appendChild(o);
    });
    psel.onchange = () => {
      Project.snapshot('マスタリング プリセット');
      const p = JSON.parse(JSON.stringify(MASTERING_PRESETS[psel.value]));
      Project.data.mastering = deepMerge(MASTERING_DEFAULTS, p);
      Project.data.mastering.preset = psel.value;
      App.rebuildAudio();
      this.open();
    };
    head.appendChild(psel);
    const close = U.el('div', 'spx-close', '✕');
    close.onclick = () => this.close();
    head.appendChild(close);
    win.appendChild(head);
    head.onmousedown = e => {
      if (e.target.closest('select,.spx-close')) return;
      const x0 = win.offsetLeft, y0 = win.offsetTop;
      U.drag(e, (dx, dy) => {
        win.style.left = U.clamp(x0 + dx, -200, window.innerWidth - 200) + 'px';
        win.style.top = U.clamp(y0 + dy, 30, window.innerHeight - 60) + 'px';
      }, null, 'grabbing');
    };

    const body = U.el('div', 'mst-body');
    win.appendChild(body);

    /* ── メーター ── */
    const meters = U.el('div', 'mst-panel mst-meters');
    meters.appendChild(U.el('div', 'spx-panel-title', 'ラウドネス / メーター'));
    const grid = U.el('div', 'mst-mgrid');
    const mk = (id, label, unit) => {
      const c = U.el('div', 'mst-cell');
      c.appendChild(U.el('div', 'mst-cell-lab', label));
      const v = U.el('div', 'mst-cell-val', '—');
      v.id = 'mst-' + id;
      c.appendChild(v);
      c.appendChild(U.el('div', 'mst-cell-unit', unit));
      grid.appendChild(c);
      return v;
    };
    mk('m', 'MOMENTARY', 'LUFS');
    mk('s', 'SHORT TERM', 'LUFS');
    mk('i', 'INTEGRATED', 'LUFS');
    mk('tp', 'TRUE PEAK', 'dBFS');
    mk('gr', 'LIMITER GR', 'dB');
    mk('corr', 'CORRELATION', '');
    meters.appendChild(grid);
    const bar = U.el('div', 'mst-lufsbar');
    bar.innerHTML = '<i id="mst-lufsfill"></i><span class="mst-target"></span>';
    meters.appendChild(bar);
    const rst = U.el('button', 'tb-btn', '積分値をリセット');
    rst.style.cssText = 'width:100%;margin-top:6px;';
    rst.onclick = () => Loudness.reset();
    meters.appendChild(rst);
    body.appendChild(meters);

    const setP = () => { App.rebuildAudio(); };
    const dbounce = (() => { let t; return fn => { clearTimeout(t); t = setTimeout(fn, 130); }; })();
    const live = () => dbounce(setP);

    /* ── EQ ── */
    const eqP = U.el('div', 'mst-panel');
    eqP.appendChild(U.el('div', 'spx-panel-title', 'マスター EQ'));
    const eqRow = U.el('div', 'spx-row');
    const E = M.eq;
    eqRow.appendChild(neonKnob('LOW', E.lowGain, -12, 12, v => { E.lowGain = v; live(); }, v => v.toFixed(1) + 'dB'));
    eqRow.appendChild(neonKnob('LO MID', E.p1Gain, -12, 12, v => { E.p1Gain = v; live(); }, v => v.toFixed(1) + 'dB'));
    eqRow.appendChild(neonKnob('HI MID', E.p2Gain, -12, 12, v => { E.p2Gain = v; live(); }, v => v.toFixed(1) + 'dB'));
    eqRow.appendChild(neonKnob('HIGH', E.highGain, -12, 12, v => { E.highGain = v; live(); }, v => v.toFixed(1) + 'dB'));
    eqP.appendChild(eqRow);
    const eqRow2 = U.el('div', 'spx-row');
    eqRow2.appendChild(neonKnob('F1', E.lowFreq, 30, 300, v => { E.lowFreq = v; live(); }, v => Math.round(v) + 'Hz', { small: true }));
    eqRow2.appendChild(neonKnob('F2', E.p1Freq, 100, 1200, v => { E.p1Freq = v; live(); }, v => Math.round(v) + 'Hz', { small: true }));
    eqRow2.appendChild(neonKnob('F3', E.p2Freq, 1000, 9000, v => { E.p2Freq = v; live(); }, v => (v / 1000).toFixed(1) + 'k', { small: true }));
    eqRow2.appendChild(neonKnob('F4', E.highFreq, 4000, 16000, v => { E.highFreq = v; live(); }, v => (v / 1000).toFixed(1) + 'k', { small: true }));
    eqP.appendChild(eqRow2);
    body.appendChild(eqP);

    /* ── マルチバンド ── */
    const mbP = U.el('div', 'mst-panel');
    const mbHead = U.el('div', 'spx-panel-head');
    mbHead.appendChild(U.el('span', 'spx-panel-title', 'マルチバンド コンプ'));
    mbHead.appendChild(SpectraUI.toggle(M.mb.on, v => { M.mb.on = v; setP(); }));
    mbP.appendChild(mbHead);
    const mbRow = U.el('div', 'spx-row');
    mbRow.appendChild(neonKnob('X-LOW', M.mb.xLow, 60, 600, v => { M.mb.xLow = v; live(); }, v => Math.round(v) + 'Hz'));
    mbRow.appendChild(neonKnob('X-HIGH', M.mb.xHigh, 1200, 8000, v => { M.mb.xHigh = v; live(); }, v => (v / 1000).toFixed(1) + 'k'));
    mbP.appendChild(mbRow);
    ['LOW', 'MID', 'HIGH'].forEach((lab, i) => {
      const b = M.mb.bands[i];
      const r = U.el('div', 'spx-row mst-bandrow');
      r.appendChild(U.el('span', 'mst-bandlab', lab));
      r.appendChild(neonKnob('TH', b.th, -50, 0, v => { b.th = v; live(); }, v => Math.round(v) + 'dB', { small: true }));
      r.appendChild(neonKnob('RATIO', b.ratio, 1, 12, v => { b.ratio = v; live(); }, v => v.toFixed(1) + ':1', { small: true }));
      r.appendChild(neonKnob('GAIN', b.makeup, 0.5, 3, v => { b.makeup = v; live(); }, v => U.dbText(v) + 'dB', { small: true }));
      mbP.appendChild(r);
    });
    body.appendChild(mbP);

    /* ── サチュレーション / ステレオ / リミッター ── */
    const outP = U.el('div', 'mst-panel');
    outP.appendChild(U.el('div', 'spx-panel-title', 'サチュレーション / ステレオ / リミッター'));
    const satHead = U.el('div', 'spx-mini-head');
    satHead.appendChild(U.el('span', null, 'SATURATION'));
    satHead.appendChild(SpectraUI.toggle(M.sat.on, v => { M.sat.on = v; setP(); }));
    outP.appendChild(satHead);
    const oRow = U.el('div', 'spx-row');
    oRow.appendChild(neonKnob('DRIVE', M.sat.amount, 0, 1, v => { M.sat.amount = v; live(); }, v => Math.round(v * 100) + '%'));
    oRow.appendChild(neonKnob('WIDTH', M.width, 0, 2, v => { M.width = v; live(); },
      v => v < 0.02 ? 'MONO' : Math.round(v * 100) + '%', { def: 1 }));
    oRow.appendChild(neonKnob('LIM TH', M.limiter.threshold, -24, 0,
      v => { M.limiter.threshold = v; live(); }, v => v.toFixed(1) + 'dB'));
    oRow.appendChild(neonKnob('RELEASE', M.limiter.release, 0.02, 0.6,
      v => { M.limiter.release = v; live(); }, v => Math.round(v * 1000) + 'ms'));
    outP.appendChild(oRow);

    const mainHead = U.el('div', 'spx-mini-head');
    mainHead.appendChild(U.el('span', null, 'マスタリング全体'));
    mainHead.appendChild(SpectraUI.toggle(M.on, v => { M.on = v; setP(); }));
    outP.appendChild(mainHead);
    body.appendChild(outP);

    document.body.appendChild(win);
    this.animate();
  },

  close() {
    if (this._raf) cancelAnimationFrame(this._raf), this._raf = null;
    if (this.win) { this.win.remove(); this.win = null; }
  },

  animate() {
    if (!this.win) return;
    const f = (id, v, dec) => {
      const el = U.$('#mst-' + id);
      if (el) el.textContent = (isFinite(v) ? v.toFixed(dec == null ? 1 : dec) : '—');
    };
    f('m', Loudness.momentary);
    f('s', Loudness.shortTerm);
    f('i', Loudness.integrated);
    const tp = Loudness.truePeak > 0 ? 20 * Math.log10(Loudness.truePeak) : -Infinity;
    f('tp', tp, 2);
    f('gr', Loudness.gainReduction(), 2);
    f('corr', Loudness.correlation, 2);

    const el = U.$('#mst-tp');
    if (el) el.style.color = tp > -0.1 ? '#ff6f6f' : (tp > -1 ? '#ffd36f' : '');
    const fill = U.$('#mst-lufsfill');
    if (fill) {
      const l = isFinite(Loudness.shortTerm) ? Loudness.shortTerm : -60;
      const t = U.clamp((l + 40) / 40, 0, 1);
      fill.style.width = (t * 100) + '%';
      fill.style.background = l > -8 ? 'linear-gradient(90deg,#3fc8ff,#ff6f6f)'
                            : l > -16 ? 'linear-gradient(90deg,#3fc8ff,#7fe8a0)'
                            : 'linear-gradient(90deg,#2a6fbd,#3fc8ff)';
    }
    this._raf = requestAnimationFrame(() => this.animate());
  }
};

window.MASTERING_DEFAULTS = MASTERING_DEFAULTS;
window.MASTERING_PRESETS = MASTERING_PRESETS;
window.buildMasteringChain = buildMasteringChain;
window.Loudness = Loudness;
window.MasteringUI = MasteringUI;
