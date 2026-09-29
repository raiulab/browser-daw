/* ══════════════════════════════════════════════════════════════
   spectra-ui.js — SPECTRA 専用エディタ画面 (フローティングウィンドウ)
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ── ネオンノブ ── */
function neonKnob(caption, value, min, max, onChange, fmt, opts) {
  opts = opts || {};
  const wrap = U.el('div', 'nk' + (opts.small ? ' nk-sm' : ''));
  const dial = U.el('div', 'nk-dial');
  const arc = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arc.setAttribute('viewBox', '0 0 44 44');
  arc.setAttribute('class', 'nk-arc');
  arc.innerHTML =
    '<circle class="nk-track" cx="22" cy="22" r="17.5"/>' +
    '<circle class="nk-fill"  cx="22" cy="22" r="17.5"/>';
  const cap = U.el('div', 'nk-cap', caption);
  const val = U.el('div', 'nk-val');
  const fill = arc.querySelector('.nk-fill');
  const CIRC = 2 * Math.PI * 17.5;
  const SWEEP = 0.75;                       /* 270 度 */
  const bipolar = (min < 0 && max > 0);

  const paint = v => {
    const t = U.clamp((v - min) / (max - min), 0, 1);
    dial.style.setProperty('--ang', (-135 + t * 270).toFixed(1) + 'deg');
    let a, b;
    if (bipolar) { const z = (0 - min) / (max - min); a = Math.min(z, t); b = Math.max(z, t); }
    else { a = 0; b = t; }
    fill.setAttribute('stroke-dasharray', CIRC * SWEEP * (b - a) + ' ' + CIRC);
    fill.setAttribute('stroke-dashoffset', -CIRC * SWEEP * a);
    val.textContent = fmt ? fmt(v) : U.round(v, 2);
  };
  paint(value);

  dial.appendChild(arc);
  dial.appendChild(U.el('div', 'nk-pointer'));
  dial.onmousedown = e => {
    e.stopPropagation();
    dial.classList.add('active');
    U.dragValue(e, value, min, max, opts.sens || 170, v => {
      if (opts.step) v = Math.round(v / opts.step) * opts.step;
      value = v; paint(v); onChange(v);
    }, () => dial.classList.remove('active'));
  };
  dial.ondblclick = e => {
    e.stopPropagation();
    const def = opts.def != null ? opts.def : (bipolar ? 0 : min);
    value = def; paint(def); onChange(def);
  };
  wrap.appendChild(dial); wrap.appendChild(val); wrap.appendChild(cap);
  wrap.__set = v => { value = v; paint(v); };
  return wrap;
}

/* ── ADSR 曲線の描画 ── */
function drawADSR(cv, env, accent) {
  const w = cv.clientWidth || 150, h = cv.clientHeight || 46;
  const ctx = U.fitCanvas(cv, w, h);
  ctx.clearRect(0, 0, w, h);
  const pad = 3;
  const total = Math.max(0.001, env.a + env.d + 0.35 + env.r);
  const xa = pad + (env.a / total) * (w - pad * 2);
  const xd = pad + ((env.a + env.d) / total) * (w - pad * 2);
  const xs = pad + ((env.a + env.d + 0.35) / total) * (w - pad * 2);
  const y0 = h - pad, y1 = pad;
  const ys = y0 - env.s * (y0 - y1);

  const grd = ctx.createLinearGradient(0, y1, 0, y0);
  grd.addColorStop(0, accent || 'rgba(90,220,255,.55)');
  grd.addColorStop(1, 'rgba(90,220,255,0)');
  ctx.beginPath();
  ctx.moveTo(pad, y0); ctx.lineTo(xa, y1); ctx.lineTo(xd, ys); ctx.lineTo(xs, ys); ctx.lineTo(w - pad, y0);
  ctx.closePath();
  ctx.fillStyle = grd; ctx.fill();
  ctx.beginPath();
  ctx.moveTo(pad, y0); ctx.lineTo(xa, y1); ctx.lineTo(xd, ys); ctx.lineTo(xs, ys); ctx.lineTo(w - pad, y0);
  ctx.strokeStyle = accent || '#5adcff'; ctx.lineWidth = 1.6;
  ctx.shadowColor = accent || '#5adcff'; ctx.shadowBlur = 6;
  ctx.stroke(); ctx.shadowBlur = 0;
  [[xa, y1], [xd, ys], [xs, ys]].forEach(([x, y]) => {
    ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 7); ctx.fillStyle = '#fff'; ctx.fill();
  });
}

/* ── ウェーブテーブルの擬似 3D 表示 ── */
function drawWavetable(cv, table, morph, phase) {
  const w = cv.clientWidth || 250, h = cv.clientHeight || 108;
  const ctx = U.fitCanvas(cv, w, h);
  ctx.clearRect(0, 0, w, h);
  const n = wtFrameCount(table);
  const shown = Math.min(n, 13);
  const curFrame = U.clamp(morph, 0, 1) * (n - 1);

  const dx = w * 0.16, dy = h * 0.40;
  const bodyW = w - dx - 12, bodyH = h - dy - 14;

  for (let i = shown - 1; i >= 0; i--) {
    const fi = Math.round(i / (shown - 1) * (n - 1));
    const t = i / (shown - 1);
    const ox = 8 + dx * (1 - t), oy = 10 + dy * t;
    const isCur = Math.abs(fi - curFrame) < (n / shown) / 2;
    const wave = wtRenderFrame(table, fi, 128);
    ctx.beginPath();
    for (let k = 0; k < wave.length; k++) {
      const x = ox + (k / (wave.length - 1)) * bodyW;
      const y = oy + bodyH / 2 - wave[k] * (bodyH / 2) * (isCur ? 0.92 : 0.7);
      if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    if (isCur) {
      ctx.strokeStyle = '#6ce8ff'; ctx.lineWidth = 2;
      ctx.shadowColor = '#3fc8ff'; ctx.shadowBlur = 12;
    } else {
      ctx.strokeStyle = 'rgba(120,170,220,' + (0.10 + t * 0.24) + ')';
      ctx.lineWidth = 1; ctx.shadowBlur = 0;
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  /* 現在位置インジケータ */
  ctx.fillStyle = 'rgba(108,232,255,.85)';
  ctx.font = '9px monospace';
  ctx.fillText('FRAME ' + (Math.round(curFrame) + 1) + '/' + n, 8, h - 3);
}

/* ══════════════════════════════════════════════════════════════ */
const SpectraUI = {
  track: null,
  win: null,
  _raf: null,
  _analyser: null,
  _rebuildT: null,
  _knobs: {},

  isOpen() { return !!this.win; },

  open(track) {
    if (!track || track.instrument.engine !== 'spectra') { U.toast('SPECTRA 音源のトラックを選択してください'); return; }
    this.close();
    this.track = track;
    const P = track.instrument.params;

    const win = U.el('div', 'spx-win');
    this.win = win;
    win.style.left = Math.max(10, (window.innerWidth - 940) / 2) + 'px';
    win.style.top = Math.max(50, (window.innerHeight - 620) / 2) + 'px';

    /* ── ヘッダ ── */
    const head = U.el('div', 'spx-head');
    const logo = U.el('div', 'spx-logo');
    logo.innerHTML = '<span class="spx-mark">◈</span><span class="spx-name">SPECTRA</span>' +
                     '<span class="spx-sub">WAVETABLE SYNTHESIZER</span>';
    head.appendChild(logo);

    const presetWrap = U.el('div', 'spx-presets');
    const sel = U.el('select', 'spx-preset-sel');
    Object.keys(SPECTRA_PRESETS).forEach(n => {
      const o = U.el('option', null, n); o.value = n;
      if (track.instrument.preset === n) o.selected = true;
      sel.appendChild(o);
    });
    sel.onchange = () => {
      Project.snapshot('SPECTRA プリセット');
      this.track.instrument = Instruments.fromPreset(sel.value);
      Engine.rebuildInstrument(this.track.id, this.track.instrument);
      App.refreshAll();
      this.open(this.track);
    };
    presetWrap.appendChild(sel);
    head.appendChild(presetWrap);

    const scope = U.el('canvas', 'spx-scope');
    head.appendChild(scope);

    const close = U.el('div', 'spx-close', '✕');
    close.onclick = () => this.close();
    head.appendChild(close);
    win.appendChild(head);

    /* ヘッダドラッグで移動 */
    head.onmousedown = e => {
      if (e.target.closest('select,.spx-close')) return;
      const x0 = win.offsetLeft, y0 = win.offsetTop;
      U.drag(e, (dx, dy) => {
        win.style.left = U.clamp(x0 + dx, -200, window.innerWidth - 200) + 'px';
        win.style.top = U.clamp(y0 + dy, 30, window.innerHeight - 60) + 'px';
      }, null, 'grabbing');
    };

    /* ── 本体 ── */
    const body = U.el('div', 'spx-body');
    win.appendChild(body);

    body.appendChild(this.oscPanel('OSC A', P.oscA, 'A'));
    body.appendChild(this.oscPanel('OSC B', P.oscB, 'B'));
    body.appendChild(this.subNoisePanel(P));
    body.appendChild(this.filterPanel(P));
    body.appendChild(this.envPanel('AMP ENV', P.env1, '#6ce8ff'));
    body.appendChild(this.envPanel('ENV 2', P.env2, '#c58cff'));
    body.appendChild(this.envPanel('ENV 3', P.env3, '#ff9ad2'));
    body.appendChild(this.lfoPanel('LFO 1', P.lfo1, 'lfo1'));
    body.appendChild(this.lfoPanel('LFO 2', P.lfo2, 'lfo2'));
    body.appendChild(this.matrixPanel(P));
    body.appendChild(this.fxPanel(P));

    document.body.appendChild(win);

    /* オシロスコープ */
    this._analyser = Engine.ctx.createAnalyser();
    this._analyser.fftSize = 1024;
    this._scopeBuf = new Float32Array(1024);
    const inst = Engine.instrument(track.id);
    if (inst && inst.tapOutput) inst.tapOutput(this._analyser);
    this._scope = scope;
    this.animate();
  },

  close() {
    if (this._raf) cancelAnimationFrame(this._raf), this._raf = null;
    if (this.win) { this.win.remove(); this.win = null; }
    this._analyser = null;
    this.track = null;
  },

  /* パラメータ変更 → できるだけライブ反映、無理なら再構築 */
  set(path, v) {
    const t = this.track; if (!t) return;
    const inst = Engine.instrument(t.id);
    if (inst && inst.setLive && inst.setLive(path, v)) return;
    clearTimeout(this._rebuildT);
    this._rebuildT = setTimeout(() => {
      Engine.rebuildInstrument(t.id, t.instrument);
      const i2 = Engine.instrument(t.id);
      if (i2 && i2.tapOutput && this._analyser) i2.tapOutput(this._analyser);
    }, 110);
  },
  markCustom() {
    if (this.track) this.track.instrument.preset = (this.track.instrument.preset || '') ;
  },

  panel(title, cls) {
    const p = U.el('div', 'spx-panel ' + (cls || ''));
    const h = U.el('div', 'spx-panel-head');
    h.appendChild(U.el('span', 'spx-panel-title', title));
    p.appendChild(h);
    p.__head = h;
    const b = U.el('div', 'spx-panel-body');
    p.appendChild(b);
    p.__body = b;
    return p;
  },
  toggle(on, onChange) {
    const t = U.el('div', 'spx-toggle' + (on ? ' on' : ''));
    t.onclick = () => { const n = !t.classList.contains('on'); t.classList.toggle('on', n); onChange(n); };
    return t;
  },

  /* ── OSC パネル ── */
  oscPanel(title, cfg, which) {
    const p = this.panel(title, 'spx-osc');
    p.__head.appendChild(this.toggle(cfg.on, v => { cfg.on = v; this.set('rebuild'); }));

    const wtSel = U.el('select', 'spx-sel');
    Object.keys(WAVETABLES).forEach(n => {
      const o = U.el('option', null, n); o.value = n;
      if (cfg.table === n) o.selected = true;
      wtSel.appendChild(o);
    });
    const cv = U.el('canvas', 'spx-wt');
    wtSel.onchange = () => { cfg.table = wtSel.value; drawWavetable(cv, cfg.table, cfg.morph); this.set('rebuild'); };
    p.__body.appendChild(wtSel);
    p.__body.appendChild(cv);
    setTimeout(() => drawWavetable(cv, cfg.table, cfg.morph), 0);

    const row1 = U.el('div', 'spx-row');
    row1.appendChild(neonKnob('MORPH', cfg.morph, 0, 1,
      v => { cfg.morph = v; drawWavetable(cv, cfg.table, v); this.set('rebuild'); },
      v => Math.round(v * 100) + '%'));
    row1.appendChild(neonKnob('UNISON', cfg.unison, 1, 8,
      v => { cfg.unison = Math.round(v); this.set('rebuild'); }, v => Math.round(v) + ' 声', { step: 1 }));
    row1.appendChild(neonKnob('DETUNE', cfg.detune, 0, 60,
      v => { cfg.detune = v; this.set('rebuild'); }, v => Math.round(v) + 'ct'));
    row1.appendChild(neonKnob('BLEND', cfg.blend, 0, 1,
      v => { cfg.blend = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    p.__body.appendChild(row1);

    const row2 = U.el('div', 'spx-row');
    row2.appendChild(neonKnob('OCT', cfg.oct, -3, 3,
      v => { cfg.oct = Math.round(v); this.set('rebuild'); }, v => (v > 0 ? '+' : '') + Math.round(v), { step: 1 }));
    row2.appendChild(neonKnob('SEMI', cfg.semi, -12, 12,
      v => { cfg.semi = Math.round(v); this.set('rebuild'); }, v => (v > 0 ? '+' : '') + Math.round(v), { step: 1 }));
    row2.appendChild(neonKnob('FINE', cfg.fine, -50, 50,
      v => { cfg.fine = v; this.set('rebuild'); }, v => Math.round(v) + 'ct'));
    row2.appendChild(neonKnob('LEVEL', cfg.level, 0, 1,
      v => { cfg.level = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    row2.appendChild(neonKnob('PAN', cfg.pan, -1, 1,
      v => { cfg.pan = v; this.set('rebuild'); },
      v => v === 0 ? 'C' : (v < 0 ? 'L' + Math.round(-v * 100) : 'R' + Math.round(v * 100))));
    p.__body.appendChild(row2);
    return p;
  },

  /* ── SUB / NOISE ── */
  subNoisePanel(P) {
    const p = this.panel('SUB / NOISE', 'spx-sub');
    const b = p.__body;

    const r1 = U.el('div', 'spx-row spx-labeled');
    const l1 = U.el('div', 'spx-mini-head');
    l1.appendChild(U.el('span', null, 'SUB'));
    l1.appendChild(this.toggle(P.sub.on, v => { P.sub.on = v; this.set('rebuild'); }));
    b.appendChild(l1);
    const waveSel = U.el('select', 'spx-sel');
    ['sine', 'triangle', 'square'].forEach(w => {
      const o = U.el('option', null, w); o.value = w;
      if (P.sub.wave === w) o.selected = true; waveSel.appendChild(o);
    });
    waveSel.onchange = () => { P.sub.wave = waveSel.value; this.set('rebuild'); };
    b.appendChild(waveSel);
    r1.appendChild(neonKnob('OCT', P.sub.oct, -2, 0,
      v => { P.sub.oct = Math.round(v); this.set('rebuild'); }, v => Math.round(v), { step: 1 }));
    r1.appendChild(neonKnob('LEVEL', P.sub.level, 0, 1,
      v => { P.sub.level = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    b.appendChild(r1);

    const l2 = U.el('div', 'spx-mini-head');
    l2.appendChild(U.el('span', null, 'NOISE'));
    l2.appendChild(this.toggle(P.noise.on, v => { P.noise.on = v; this.set('rebuild'); }));
    b.appendChild(l2);
    const r2 = U.el('div', 'spx-row');
    r2.appendChild(neonKnob('LEVEL', P.noise.level, 0, 1,
      v => { P.noise.level = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    r2.appendChild(neonKnob('COLOR', P.noise.color, 200, 16000,
      v => { P.noise.color = v; this.set('rebuild'); }, v => (v / 1000).toFixed(1) + 'k'));
    b.appendChild(r2);
    return p;
  },

  /* ── FILTER ── */
  filterPanel(P) {
    const p = this.panel('FILTER', 'spx-filter');
    p.__head.appendChild(this.toggle(P.filter.on, v => { P.filter.on = v; this.set('rebuild'); }));
    const b = p.__body;
    const sel = U.el('select', 'spx-sel');
    [['lowpass', 'LP ローパス'], ['highpass', 'HP ハイパス'],
     ['bandpass', 'BP バンドパス'], ['notch', 'ノッチ']].forEach(([v, l]) => {
      const o = U.el('option', null, l); o.value = v;
      if (P.filter.type === v) o.selected = true; sel.appendChild(o);
    });
    sel.onchange = () => { P.filter.type = sel.value; this.set('rebuild'); };
    b.appendChild(sel);

    const r1 = U.el('div', 'spx-row');
    r1.appendChild(neonKnob('CUTOFF', P.filter.cutoff, 30, 18000,
      v => { P.filter.cutoff = v; this.set('filter.cutoff', v); },
      v => v >= 1000 ? (v / 1000).toFixed(2) + 'k' : Math.round(v) + '', { sens: 220 }));
    r1.appendChild(neonKnob('RES', P.filter.res, 0.1, 22,
      v => { P.filter.res = v; this.set('filter.res', v); }, v => v.toFixed(1)));
    r1.appendChild(neonKnob('DRIVE', P.filter.drive, 0, 1,
      v => { P.filter.drive = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    b.appendChild(r1);
    const r2 = U.el('div', 'spx-row');
    r2.appendChild(neonKnob('ENV 2', P.filter.env2, -8000, 10000,
      v => { P.filter.env2 = v; this.set('rebuild'); }, v => (v > 0 ? '+' : '') + Math.round(v / 100) / 10 + 'k'));
    r2.appendChild(neonKnob('KEY', P.filter.keytrack, 0, 1,
      v => { P.filter.keytrack = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'));
    b.appendChild(r2);
    return p;
  },

  /* ── ENVELOPE ── */
  envPanel(title, env, accent) {
    const p = this.panel(title, 'spx-env');
    const b = p.__body;
    const cv = U.el('canvas', 'spx-adsr');
    b.appendChild(cv);
    const redraw = () => drawADSR(cv, env, accent);
    setTimeout(redraw, 0);
    const r = U.el('div', 'spx-row');
    const mk = (cap, key, min, max, fmt) => neonKnob(cap, env[key], min, max,
      v => { env[key] = v; redraw(); this.set('rebuild'); }, fmt, { small: true });
    r.appendChild(mk('A', 'a', 0.001, 4, v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'));
    r.appendChild(mk('D', 'd', 0.005, 6, v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'));
    r.appendChild(mk('S', 's', 0, 1, v => Math.round(v * 100) + '%'));
    r.appendChild(mk('R', 'r', 0.005, 8, v => v < 1 ? Math.round(v * 1000) + 'ms' : v.toFixed(2) + 's'));
    b.appendChild(r);
    return p;
  },

  /* ── LFO ── */
  lfoPanel(title, cfg, key) {
    const p = this.panel(title, 'spx-lfo');
    const b = p.__body;
    const cv = U.el('canvas', 'spx-lfoview');
    b.appendChild(cv);
    const sel = U.el('select', 'spx-sel');
    [['sine', 'サイン'], ['triangle', '三角'], ['square', '矩形'], ['sawtooth', 'ノコギリ']].forEach(([v, l]) => {
      const o = U.el('option', null, l); o.value = v;
      if (cfg.shape === v) o.selected = true; sel.appendChild(o);
    });
    const draw = () => this.drawLfo(cv, cfg);
    sel.onchange = () => { cfg.shape = sel.value; draw(); this.set('rebuild'); };
    b.appendChild(sel);
    setTimeout(draw, 0);
    const r = U.el('div', 'spx-row');
    r.appendChild(neonKnob('RATE', cfg.rate, 0.02, 20,
      v => { cfg.rate = v; draw(); this.set(key + '.rate', v); },
      v => v < 1 ? v.toFixed(2) + 'Hz' : v.toFixed(1) + 'Hz', { sens: 200 }));
    b.appendChild(r);
    return p;
  },
  drawLfo(cv, cfg) {
    const w = cv.clientWidth || 120, h = cv.clientHeight || 40;
    const ctx = U.fitCanvas(cv, w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = '#c58cff'; ctx.lineWidth = 1.6;
    ctx.shadowColor = '#a05cff'; ctx.shadowBlur = 7;
    ctx.beginPath();
    const cycles = 2;
    for (let x = 0; x <= w; x++) {
      const t = (x / w) * cycles;
      let v;
      const ph = (t % 1);
      switch (cfg.shape) {
        case 'square':   v = ph < 0.5 ? 1 : -1; break;
        case 'sawtooth': v = 1 - 2 * ph; break;
        case 'triangle': v = ph < 0.5 ? (4 * ph - 1) : (3 - 4 * ph); break;
        default:         v = Math.sin(t * Math.PI * 2);
      }
      const y = h / 2 - v * (h / 2 - 4);
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke(); ctx.shadowBlur = 0;
  },

  /* ── MOD MATRIX ── */
  matrixPanel(P) {
    const p = this.panel('MOD MATRIX', 'spx-matrix');
    const b = p.__body;
    while (P.matrix.length < 8) P.matrix.push({ src: 'none', dst: 'cutoff', amt: 0 });
    P.matrix.slice(0, 8).forEach((m, i) => {
      const row = U.el('div', 'spx-mrow');
      row.appendChild(U.el('span', 'spx-mnum', String(i + 1)));

      const src = U.el('select', 'spx-sel spx-sel-sm');
      Object.keys(SPECTRA_SRC).forEach(k => {
        const o = U.el('option', null, SPECTRA_SRC[k]); o.value = k;
        if (m.src === k) o.selected = true; src.appendChild(o);
      });
      src.onchange = () => { m.src = src.value; row.classList.toggle('active', m.src !== 'none'); this.set('rebuild'); };
      row.appendChild(src);

      row.appendChild(U.el('span', 'spx-arrow', '▸'));

      const dst = U.el('select', 'spx-sel spx-sel-sm');
      Object.keys(SPECTRA_DEST).forEach(k => {
        const o = U.el('option', null, SPECTRA_DEST[k].label); o.value = k;
        if (m.dst === k) o.selected = true; dst.appendChild(o);
      });
      dst.onchange = () => { m.dst = dst.value; this.set('rebuild'); };
      row.appendChild(dst);

      const bar = U.el('div', 'spx-amt');
      const fill = U.el('i');
      bar.appendChild(fill);
      const txt = U.el('span', 'spx-amt-txt');
      const paint = () => {
        const t = U.clamp(m.amt, -1, 1);
        fill.style.left = (t < 0 ? 50 + t * 50 : 50) + '%';
        fill.style.width = Math.abs(t) * 50 + '%';
        fill.style.background = t < 0 ? 'linear-gradient(90deg,#ff6fae,#ff9ad2)' : 'linear-gradient(90deg,#3fc8ff,#6ce8ff)';
        txt.textContent = (t > 0 ? '+' : '') + (t * 100).toFixed(0) + '%';
      };
      paint();
      bar.onmousedown = e => {
        U.dragValue(e, m.amt, -1, 1, 150, v => { m.amt = v; paint(); this.set('rebuild'); });
      };
      bar.ondblclick = () => { m.amt = 0; paint(); this.set('rebuild'); };
      row.appendChild(bar);
      row.appendChild(txt);
      row.classList.toggle('active', m.src !== 'none');
      b.appendChild(row);
    });
    return p;
  },

  /* ── 内蔵 FX ── */
  fxPanel(P) {
    const p = this.panel('FX / OUTPUT', 'spx-fx');
    const b = p.__body;
    const mk = (label, onKey, ctrls) => {
      const head = U.el('div', 'spx-mini-head');
      head.appendChild(U.el('span', null, label));
      head.appendChild(this.toggle(P.fx[onKey], v => { P.fx[onKey] = v; this.set('rebuild'); }));
      b.appendChild(head);
      const r = U.el('div', 'spx-row');
      ctrls.forEach(c => r.appendChild(c));
      b.appendChild(r);
    };
    mk('DRIVE', 'driveOn', [
      neonKnob('AMT', P.fx.drive, 0, 1, v => { P.fx.drive = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%')
    ]);
    mk('CHORUS', 'chorusOn', [
      neonKnob('RATE', P.fx.chorusRate, 0.05, 6, v => { P.fx.chorusRate = v; this.set('rebuild'); }, v => v.toFixed(2) + 'Hz'),
      neonKnob('MIX', P.fx.chorusMix, 0, 1, v => { P.fx.chorusMix = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%')
    ]);
    mk('DELAY', 'delayOn', [
      neonKnob('TIME', P.fx.delayTime, 0.02, 1.2, v => { P.fx.delayTime = v; this.set('rebuild'); }, v => Math.round(v * 1000) + 'ms'),
      neonKnob('FB', P.fx.delayFb, 0, 0.85, v => { P.fx.delayFb = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%'),
      neonKnob('MIX', P.fx.delayMix, 0, 1, v => { P.fx.delayMix = v; this.set('rebuild'); }, v => Math.round(v * 100) + '%')
    ]);
    const outHead = U.el('div', 'spx-mini-head');
    outHead.appendChild(U.el('span', null, 'OUTPUT'));
    b.appendChild(outHead);
    const r = U.el('div', 'spx-row');
    r.appendChild(neonKnob('LEVEL', P.level, 0, 1,
      v => { P.level = v; this.set('level', v); }, v => U.dbText(v) + 'dB'));
    r.appendChild(neonKnob('VOICES', P.voices, 1, 16,
      v => { P.voices = Math.round(v); this.set('rebuild'); }, v => Math.round(v), { step: 1 }));
    b.appendChild(r);
    return p;
  },

  /* ── オシロスコープのアニメーション ── */
  animate() {
    if (!this.win) return;
    const cv = this._scope;
    if (cv && this._analyser) {
      const w = cv.clientWidth || 200, h = cv.clientHeight || 40;
      const ctx = U.fitCanvas(cv, w, h);
      this._analyser.getFloatTimeDomainData(this._scopeBuf);
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#6ce8ff'; ctx.lineWidth = 1.4;
      ctx.shadowColor = '#3fc8ff'; ctx.shadowBlur = 8;
      ctx.beginPath();
      const b = this._scopeBuf;
      /* ゼロクロス同期で波形を安定させる */
      let start = 0;
      for (let i = 1; i < b.length / 2; i++) { if (b[i - 1] <= 0 && b[i] > 0) { start = i; break; } }
      const n = Math.floor(b.length / 2);
      for (let i = 0; i < n; i++) {
        const x = (i / n) * w;
        const y = h / 2 - b[start + i] * (h / 2) * 1.7;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.shadowBlur = 0;
      const inst = Engine.instrument(this.track && this.track.id);
      if (inst && inst.activeVoices) {
        ctx.fillStyle = 'rgba(140,200,240,.6)'; ctx.font = '8px monospace';
        ctx.fillText(inst.activeVoices() + ' voices', 4, 9);
      }
    }
    this._raf = requestAnimationFrame(() => this.animate());
  }
};

window.SpectraUI = SpectraUI;
window.neonKnob = neonKnob;
