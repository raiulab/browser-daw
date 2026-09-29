/* ══════════════════════════════════════════════════════════════
   arrange.js — アレンジウィンドウ (トラックヘッダ / ルーラ / リージョン)
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Arrange = {
  pxPerBeat: 26,
  tool: 'pointer',
  snap: 0.25,
  selTracks: new Set(),
  selRegions: new Set(),
  _thInner: null,
  _vw: 0, _vh: 0,

  /* ── 初期化 ── */
  init() {
    const gw = U.$('#grid-wrap');
    this._thInner = U.el('div', 'th-inner');
    this._thInner.style.cssText = 'position:absolute;left:0;top:0;width:100%;';
    U.$('#track-headers').appendChild(this._thInner);

    gw.addEventListener('scroll', () => this.onScroll());
    gw.addEventListener('mousedown', e => this.onGridMouseDown(e));
    gw.addEventListener('contextmenu', e => this.onGridContext(e));
    gw.addEventListener('wheel', e => {
      if (U.cmd(e)) {           // ⌘/Ctrl + ホイール = 水平ズーム
        e.preventDefault();
        const before = (gw.scrollLeft + e.offsetX) / this.pxPerBeat;
        this.setZoom(this.pxPerBeat * (e.deltaY < 0 ? 1.12 : 1 / 1.12));
        gw.scrollLeft = before * this.pxPerBeat - e.offsetX;
        this.onScroll();
      } else if (e.shiftKey) {
        e.preventDefault(); gw.scrollLeft += e.deltaY;
      }
    }, { passive: false });

    const rw = U.$('#ruler-wrap');
    rw.addEventListener('mousedown', e => this.onRulerMouseDown(e));
    rw.addEventListener('contextmenu', e => { e.preventDefault(); this.rulerContext(e); });

    U.$('#zoom-h').addEventListener('input', e => { this.setZoom(+e.target.value); });
    U.$('#zoom-in').onclick  = () => this.setZoom(this.pxPerBeat * 1.25);
    U.$('#zoom-out').onclick = () => this.setZoom(this.pxPerBeat / 1.25);
    U.$('#zoom-v').addEventListener('input', e => this.setTrackHeight(+e.target.value));
    U.$('#vzoom-in').onclick  = () => this.setTrackHeight(this.avgHeight() * 1.2);
    U.$('#vzoom-out').onclick = () => this.setTrackHeight(this.avgHeight() / 1.2);
    U.$('#snap-select').addEventListener('change', e => {
      this.snap = +e.target.value;
      Project.data.division = this.snap || 0.25;
      App.updateLCD();
    });
    U.$$('.tool').forEach(b => b.onclick = () => this.setTool(b.dataset.tool));
    U.$('#btn-add-track').onclick = () => App.addTrackDialog();
    U.$('#btn-del-track').onclick = () => App.deleteSelectedTracks();
    const imp = U.$('#btn-import-audio');
    if (imp) imp.onclick = () => App.openAudioDialog();

    window.addEventListener('resize', () => this.layout());
  },

  avgHeight() {
    const t = Project.data.tracks;
    return t.length ? t.reduce((a, x) => a + x.height, 0) / t.length : 76;
  },
  setTrackHeight(h) {
    h = U.clamp(Math.round(h), 42, 180);
    Project.data.tracks.forEach(t => t.height = h);
    U.$('#zoom-v').value = h;
    this.render();
  },
  setZoom(v) {
    this.pxPerBeat = U.clamp(v, 6, 400);
    U.$('#zoom-h').value = U.clamp(Math.round(this.pxPerBeat), 12, 220);
    this.render();
  },
  setTool(t) {
    this.tool = t;
    U.$$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    const cur = { pointer: 'default', pencil: 'crosshair', eraser: 'not-allowed',
                  scissors: 'col-resize', glue: 'copy', mute: 'pointer' }[t] || 'default';
    U.$('#grid-wrap').style.cursor = cur;
  },

  /* ── 座標変換 ── */
  beatToX(b) { return b * this.pxPerBeat; },
  xToBeat(x) { return x / this.pxPerBeat; },
  snapBeat(b) {
    if (!this.snap) return Math.max(0, b);
    return Math.max(0, Math.round(b / this.snap) * this.snap);
  },
  trackTops() {
    const tops = []; let y = 0;
    Project.data.tracks.forEach(t => { tops.push(y); y += t.height; });
    return { tops, total: y };
  },
  trackAtY(y) {
    const { tops } = this.trackTops();
    const ts = Project.data.tracks;
    for (let i = ts.length - 1; i >= 0; i--) if (y >= tops[i]) return i;
    return ts.length ? 0 : -1;
  },

  /* ── レイアウト / 描画 ── */
  layout() {
    const gw = U.$('#grid-wrap');
    this._vw = gw.clientWidth; this._vh = gw.clientHeight;
    this.render();
  },

  render() {
    if (!Project.data) return;
    this.renderHeaders();
    this.renderRegions();
    this.drawGrid();
    this.drawRuler();
    this.updatePlayhead();
    this.updateCycleZone();
  },

  onScroll() {
    const gw = U.$('#grid-wrap');
    this._thInner.style.transform = 'translateY(' + (-gw.scrollTop) + 'px)';
    this.drawGrid();
    this.drawRuler();
  },

  /* ── トラックヘッダ ── */
  renderHeaders() {
    const inner = this._thInner;
    inner.innerHTML = '';
    const { tops, total } = this.trackTops();
    inner.style.height = total + 'px';

    Project.data.tracks.forEach((t, i) => {
      const d = U.el('div', 'trk' + (this.selTracks.has(t.id) ? ' selected' : '') + (t.height < 56 ? ' compact' : ''));
      d.style.top = tops[i] + 'px';
      d.style.height = t.height + 'px';
      d.dataset.id = t.id;

      const col = U.el('div', 'trk-color'); col.style.background = t.color;
      col.title = 'クリックでカラー変更';
      col.onclick = e => { e.stopPropagation(); App.pickColor(t); };
      d.appendChild(col);

      const inn = U.el('div', 'trk-inner');
      /* 上段 */
      const top = U.el('div', 'trk-top');
      top.appendChild(U.el('span', 'trk-num', String(i + 1)));
      const nm = U.el('div', 'trk-name', t.name);
      nm.title = 'ダブルクリックで名称変更';
      nm.ondblclick = e => {
        e.stopPropagation();
        nm.contentEditable = 'true'; nm.focus();
        document.execCommand && document.execCommand('selectAll', false, null);
        const fin = () => {
          nm.contentEditable = 'false';
          const v = nm.textContent.trim();
          if (v && v !== t.name) { Project.snapshot('トラック名変更'); t.name = v; App.refreshAll(); }
          else nm.textContent = t.name;
        };
        nm.onblur = fin;
        nm.onkeydown = ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); nm.blur(); } };
      };
      top.appendChild(nm);

      const btns = U.el('div', 'trk-btns');
      const mk = (cls, label, on, fn, tip) => {
        const b = U.el('button', 'tbtn ' + cls + (on ? ' on' : ''), label);
        b.title = tip;
        b.onclick = e => { e.stopPropagation(); fn(); };
        return b;
      };
      btns.appendChild(mk('m', 'M', t.mute, () => { t.mute = !t.mute; App.applyMix(); this.renderHeaders(); Mixer.render(); }, 'ミュート'));
      btns.appendChild(mk('s', 'S', t.solo, () => { t.solo = !t.solo; App.applyMix(); this.renderHeaders(); Mixer.render(); }, 'ソロ'));
      btns.appendChild(mk('r', '●', t.armed, () => {
        t.armed = !t.armed;
        if (t.armed) Project.data.tracks.forEach(o => { if (o !== t) o.armed = false; });
        this.renderHeaders();
      }, '録音待機'));
      top.appendChild(btns);
      inn.appendChild(top);

      /* 中段: フェーダー / パン / メーター */
      const mid = U.el('div', 'trk-mid');
      const fad = U.el('input', 'trk-fader'); fad.type = 'range';
      fad.min = 0; fad.max = 1; fad.step = 0.001; fad.value = U.gainToFader(t.volume);
      fad.title = 'ボリューム';
      fad.oninput = e => { t.volume = U.faderToGain(+e.target.value); App.applyMix(); Mixer.syncStrip(t.id); };
      fad.onmousedown = e => e.stopPropagation();
      mid.appendChild(fad);
      const pan = U.el('input', 'trk-pan'); pan.type = 'range';
      pan.min = -1; pan.max = 1; pan.step = 0.01; pan.value = t.pan; pan.title = 'パン';
      pan.oninput = e => { t.pan = +e.target.value; App.applyMix(); Mixer.syncStrip(t.id); };
      pan.onmousedown = e => e.stopPropagation();
      mid.appendChild(pan);
      const mtr = U.el('div', 'trk-meter'); const mi = U.el('i'); mtr.appendChild(mi);
      mtr.dataset.meter = t.id;
      mid.appendChild(mtr);
      inn.appendChild(mid);

      const instLabel = t.type === 'audio'
        ? '♪ オーディオトラック'
        : (t.instrument.preset || t.instrument.engine);
      const instEl = U.el('div', 'trk-inst', instLabel);
      if (t.type !== 'audio' && t.instrument.engine === 'spectra') {
        instEl.classList.add('spx-link');
        instEl.title = 'クリックで SPECTRA を開く';
        instEl.onclick = ev => { ev.stopPropagation(); SpectraUI.open(t); };
      }
      inn.appendChild(instEl);
      d.appendChild(inn);

      /* 高さリサイズ用ハンドル */
      const rs = U.el('div');
      rs.style.cssText = 'position:absolute;left:0;bottom:0;width:100%;height:4px;cursor:ns-resize;';
      rs.onmousedown = e => {
        e.stopPropagation();
        const h0 = t.height;
        U.drag(e, dy => { t.height = U.clamp(h0 + dy, 42, 260); this.render(); }, null, 'ns-resize');
      };
      d.style.position = 'absolute';
      d.appendChild(rs);

      d.onmousedown = e => {
        if (e.target.closest('input,button,.trk-name')) return;
        this.selectTrack(t.id, e.shiftKey || U.cmd(e));
        /* ドラッグで並べ替え */
        const startIdx = i;
        U.drag(e, dy => {
          const ni = U.clamp(startIdx + Math.round(dy / t.height), 0, Project.data.tracks.length - 1);
          if (ni !== Project.data.tracks.indexOf(t)) {
            const arr = Project.data.tracks;
            arr.splice(arr.indexOf(t), 1); arr.splice(ni, 0, t);
            this.render();
          }
        }, (ev, moved) => { if (moved) { Project.snapshot('トラック並べ替え'); Mixer.render(); } });
      };
      d.oncontextmenu = e => { e.preventDefault(); App.trackContextMenu(e, t); };
      inner.appendChild(d);
    });
  },

  selectTrack(id, add) {
    if (!add) this.selTracks.clear();
    if (this.selTracks.has(id) && add) this.selTracks.delete(id); else this.selTracks.add(id);
    App.selectedTrackId = id;
    this.renderHeaders();
    Inspector.render();
    Mixer.render();
    StepSeq.render();
  },

  /* ── グリッド描画 ── */
  drawGrid() {
    const gw = U.$('#grid-wrap');
    const cv = U.$('#grid-canvas');
    const w = gw.clientWidth, h = gw.clientHeight;
    if (w <= 0 || h <= 0) return;
    cv.style.left = gw.scrollLeft + 'px';
    cv.style.top  = gw.scrollTop + 'px';
    const ctx = U.fitCanvas(cv, w, h);
    const sx = gw.scrollLeft, sy = gw.scrollTop;
    const p = Project.data;

    /* トラック行の背景 */
    ctx.fillStyle = '#17171a';
    ctx.fillRect(0, 0, w, h);
    const { tops, total } = this.trackTops();
    p.tracks.forEach((t, i) => {
      const y = tops[i] - sy;
      if (y > h || y + t.height < 0) return;
      ctx.fillStyle = (i % 2 === 0) ? '#1e1e22' : '#212126';
      if (this.selTracks.has(t.id)) ctx.fillStyle = (i % 2 === 0) ? '#23272e' : '#262a32';
      ctx.fillRect(0, y, w, t.height);
      ctx.fillStyle = '#0d0d0f';
      ctx.fillRect(0, y + t.height - 1, w, 1);
    });

    /* 縦線 */
    const ppb = this.pxPerBeat;
    const beat0 = sx / ppb;
    const beat1 = (sx + w) / ppb;
    const sig = p.sigNum;
    const divPx = ppb * (this.snap || 0.25);
    const drawDiv = divPx > 7;
    const drawBeat = ppb > 10;

    ctx.lineWidth = 1;
    if (drawDiv) {
      ctx.strokeStyle = '#222228'; ctx.beginPath();
      const step = this.snap || 0.25;
      for (let b = Math.floor(beat0 / step) * step; b <= beat1; b += step) {
        if (Math.abs(b % 1) < 1e-6) continue;
        const x = Math.round(b * ppb - sx) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      ctx.stroke();
    }
    if (drawBeat) {
      ctx.strokeStyle = '#2b2b32'; ctx.beginPath();
      for (let b = Math.ceil(beat0); b <= beat1; b++) {
        if (b % sig === 0) continue;
        const x = Math.round(b * ppb - sx) + 0.5;
        ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = '#3f3f48'; ctx.beginPath();
    for (let b = Math.floor(beat0 / sig) * sig; b <= beat1; b += sig) {
      const x = Math.round(b * ppb - sx) + 0.5;
      ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    ctx.stroke();

    /* プロジェクト終端より後ろを暗く */
    const endX = Project.data.lengthBars * sig * ppb - sx;
    if (endX < w) { ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(endX, 0, w - endX, h); }
    /* トラックが無い領域 */
    if (total - sy < h) { ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, total - sy, w, h - (total - sy)); }
  },

  /* ── ルーラ描画 ── */
  drawRuler() {
    const gw = U.$('#grid-wrap');
    const cv = U.$('#ruler');
    const w = U.$('#ruler-wrap').clientWidth, h = 30;
    if (w <= 0) return;
    const ctx = U.fitCanvas(cv, w, h);
    const sx = gw.scrollLeft, ppb = this.pxPerBeat, p = Project.data, sig = p.sigNum;

    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#2f2f35'); grd.addColorStop(1, '#232328');
    ctx.fillStyle = grd; ctx.fillRect(0, 0, w, h);

    /* サイクル帯 */
    if (p.cycle.on) {
      const x0 = p.cycle.start * ppb - sx, x1 = p.cycle.end * ppb - sx;
      ctx.fillStyle = 'rgba(240,192,64,.75)';
      ctx.fillRect(x0, 0, Math.max(2, x1 - x0), 9);
    }
    ctx.fillStyle = '#191a1e'; ctx.fillRect(0, 9, w, 1);

    const beat0 = sx / ppb, beat1 = (sx + w) / ppb;
    const barPx = ppb * sig;
    let barStep = 1;
    while (barPx * barStep < 46) barStep *= 2;

    ctx.font = '10px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';
    for (let b = Math.floor(beat0 / sig) * sig; b <= beat1; b += sig) {
      const bar = b / sig;
      const x = Math.round(b * ppb - sx) + 0.5;
      const major = (bar % barStep === 0);
      ctx.strokeStyle = major ? '#787885' : '#4a4a52';
      ctx.beginPath(); ctx.moveTo(x, major ? 11 : 21); ctx.lineTo(x, h); ctx.stroke();
      if (major) { ctx.fillStyle = '#c8c8d2'; ctx.fillText(String(bar + 1), x + 4, 21); }
    }
    if (ppb > 26) {
      ctx.strokeStyle = '#3a3a42';
      for (let b = Math.ceil(beat0); b <= beat1; b++) {
        if (b % sig === 0) continue;
        const x = Math.round(b * ppb - sx) + 0.5;
        ctx.beginPath(); ctx.moveTo(x, 24); ctx.lineTo(x, h); ctx.stroke();
      }
    }

    /* マーカー */
    p.markers.forEach(m => {
      const x = m.pos * ppb - sx;
      if (x < -70 || x > w) return;
      ctx.fillStyle = '#c88a2a';
      ctx.beginPath(); ctx.moveTo(x, 11); ctx.lineTo(x + 6, 15); ctx.lineTo(x, 19); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8b860'; ctx.font = '9px sans-serif';
      ctx.fillText(m.name, x + 8, 15);
    });

    /* 再生ヘッド三角 */
    const px = (Transport.isPlaying() ? Transport.now() : Transport.positionBeats) * ppb - sx;
    if (px >= -8 && px <= w + 8) {
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.moveTo(px - 5, h - 9); ctx.lineTo(px + 5, h - 9); ctx.lineTo(px, h); ctx.closePath(); ctx.fill();
    }
  },

  /* ── リージョン ── */
  renderRegions() {
    const layer = U.$('#regions-layer');
    layer.innerHTML = '';
    const { tops, total } = this.trackTops();
    const totalBeats = Project.lengthBeats();
    const W = Math.max(totalBeats * this.pxPerBeat, U.$('#grid-wrap').clientWidth);
    layer.style.width = W + 'px';
    layer.style.height = Math.max(total, U.$('#grid-wrap').clientHeight) + 'px';

    Project.data.tracks.forEach((t, ti) => {
      t.regions.forEach(r => layer.appendChild(this.buildRegionEl(t, r, tops[ti])));
    });
    U.$('#playhead').style.height = layer.style.height;
    U.$('#cycle-zone').style.height = layer.style.height;
  },

  buildRegionEl(t, r, top) {
    const ppb = this.pxPerBeat;
    const reps = 1 + (r.loop || 0);
    const d = U.el('div', 'region' + (this.selRegions.has(r.id) ? ' selected' : '') + (r.mute ? ' muted' : ''));
    d.dataset.id = r.id; d.dataset.track = t.id;
    d.style.left = this.beatToX(r.start) + 'px';
    d.style.top = (top + 1) + 'px';
    d.style.width = Math.max(4, r.length * reps * ppb - 1) + 'px';
    d.style.height = (t.height - 3) + 'px';
    d.style.background = 'linear-gradient(' + U.shade(t.color, 6) + ',' + U.shade(t.color, -34) + ')';

    const head = U.el('div', 'rg-head', (r.name || '') + (r.loop ? '  ⟳' + (r.loop + 1) : '') +
      (r.transpose ? '  ' + (r.transpose > 0 ? '+' : '') + r.transpose : ''));
    d.appendChild(head);
    const body = U.el('div', 'rg-body');
    d.appendChild(body);

    /* プレビュー描画 */
    const w = Math.max(4, r.length * reps * ppb - 1), h = Math.max(4, t.height - 16);
    const cv = U.el('canvas');
    const ctx = U.fitCanvas(cv, w, h);

    if (r.type === 'audio') {
      this.drawRegionWave(ctx, r, w, h, reps);
    } else if (r.notes.length) {
      let lo = 127, hi = 0;
      r.notes.forEach(n => { if (n.pitch < lo) lo = n.pitch; if (n.pitch > hi) hi = n.pitch; });
      if (hi - lo < 11) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = Math.ceil(c + 6); }
      const nh = Math.max(1.6, h / (hi - lo + 1));
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      for (let k = 0; k < reps; k++) {
        const xo = k * r.length * ppb;
        r.notes.forEach(n => {
          const x = xo + n.start * ppb;
          const y = h - (n.pitch - lo + 1) * nh;
          ctx.fillRect(x, y, Math.max(1.4, n.length * ppb - 0.6), Math.max(1.4, nh - 0.7));
        });
        if (k > 0) {
          ctx.fillStyle = 'rgba(255,255,255,.28)';
          ctx.fillRect(xo, 0, 1, h);
          ctx.fillStyle = 'rgba(0,0,0,.62)';
        }
      }
    }
    body.appendChild(cv);

    if (r.type === 'audio') {
      d.classList.add('audio');
      /* フェードハンドル */
      const fi = U.el('div', 'rg-fade rg-fade-in');
      fi.style.width = Math.max(0, (r.fadeIn || 0) * ppb) + 'px';
      const fo = U.el('div', 'rg-fade rg-fade-out');
      fo.style.width = Math.max(0, (r.fadeOut || 0) * ppb) + 'px';
      body.appendChild(fi); body.appendChild(fo);
      const fih = U.el('div', 'rg-fadeh rg-fadeh-in');  fih.title = 'フェードイン';
      const foh = U.el('div', 'rg-fadeh rg-fadeh-out'); foh.title = 'フェードアウト';
      fih.style.left = Math.max(0, (r.fadeIn || 0) * ppb) + 'px';
      foh.style.right = Math.max(0, (r.fadeOut || 0) * ppb) + 'px';
      fih.onmousedown = e => { e.stopPropagation(); this.dragFade(e, r, 'in'); };
      foh.onmousedown = e => { e.stopPropagation(); this.dragFade(e, r, 'out'); };
      d.appendChild(fih); d.appendChild(foh);
    }

    d.appendChild(Object.assign(U.el('div', 'rg-handle rg-l'), {}));
    d.appendChild(Object.assign(U.el('div', 'rg-handle rg-r'), {}));
    const lh = U.el('div', 'rg-loop'); lh.title = 'ドラッグでループ回数';
    d.appendChild(lh);
    return d;
  },

  /* オーディオリージョンの波形描画 */
  drawRegionWave(ctx, r, w, h, reps) {
    const a = AudioPool.get(r.audioId);
    if (!a) {
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.font = '9px sans-serif';
      ctx.fillText('オーディオ未読込', 4, h / 2);
      return;
    }
    const buf = a.buffer, peaks = a.peaks;
    const spb = 60 / Project.data.tempo;
    const secPerRep = r.length * spb * (r.rate || 1);
    const oneW = w / reps;
    ctx.fillStyle = 'rgba(0,0,0,.62)';
    for (let k = 0; k < reps; k++) {
      const xo = k * oneW;
      for (let x = 0; x < oneW; x++) {
        const tsec = (r.offset || 0) + (x / oneW) * secPerRep;
        const idx = Math.floor(tsec * buf.sampleRate / peaks.bucket);
        const nextIdx = Math.floor(((tsec + secPerRep / oneW) * buf.sampleRate) / peaks.bucket);
        let lo = 0, hi = 0;
        for (let c = 0; c < peaks.channels.length; c++) {
          const pk = peaks.channels[c];
          for (let i = idx; i <= Math.max(idx, Math.min(nextIdx, pk.min.length - 1)); i++) {
            if (i < 0 || i >= pk.min.length) continue;
            if (pk.min[i] < lo) lo = pk.min[i];
            if (pk.max[i] > hi) hi = pk.max[i];
          }
        }
        const mid = h / 2, amp = h / 2 - 1;
        ctx.fillRect(xo + x, mid - hi * amp, 1, Math.max(1, (hi - lo) * amp));
      }
      if (k > 0) { ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(xo, 0, 1, h); ctx.fillStyle = 'rgba(0,0,0,.62)'; }
    }
  },

  dragFade(e, r, which) {
    const ppb = this.pxPerBeat;
    const v0 = (which === 'in' ? r.fadeIn : r.fadeOut) || 0;
    let did = false;
    U.drag(e, dx => {
      if (!did) { Project.snapshot('フェード変更'); did = true; }
      const d = (which === 'in' ? dx : -dx) / ppb;
      const v = U.clamp(v0 + d, 0, r.length * 0.95);
      if (which === 'in') r.fadeIn = v; else r.fadeOut = v;
      this.renderRegions();
    }, () => { if (did) Inspector.render(); }, 'ew-resize');
  },

  /* ── グリッド上のマウス操作 ── */
  onGridMouseDown(e) {
    if (e.button !== 0) return;
    const gw = U.$('#grid-wrap');
    const rect = gw.getBoundingClientRect();
    const x = e.clientX - rect.left + gw.scrollLeft;
    const y = e.clientY - rect.top + gw.scrollTop;
    const beat = this.xToBeat(x);
    const ti = this.trackAtY(y);
    const track = ti >= 0 ? Project.data.tracks[ti] : null;
    const regEl = e.target.closest('.region');

    /* ─ ツール別 ─ */
    if (this.tool === 'pencil' && !regEl && track) { this.createRegion(track, beat); return; }
    if (regEl) {
      const rid = regEl.dataset.id;
      const found = Project.region(rid); if (!found) return;
      const r = found.region, rt = found.track;

      if (this.tool === 'eraser') { Project.snapshot('リージョン削除'); rt.regions.splice(rt.regions.indexOf(r), 1); this.selRegions.delete(rid); App.refreshAll(); return; }
      if (this.tool === 'mute')   { Project.snapshot('リージョンミュート'); r.mute = !r.mute; App.refreshAll(); return; }
      if (this.tool === 'scissors') { this.splitRegion(rt, r, this.snapBeat(beat)); return; }
      if (this.tool === 'glue') { this.glueSelected(rt); return; }

      /* 選択 */
      if (!this.selRegions.has(rid)) {
        if (!(e.shiftKey || U.cmd(e))) this.selRegions.clear();
        this.selRegions.add(rid);
      } else if (e.shiftKey || U.cmd(e)) {
        this.selRegions.delete(rid);
      }
      this.selectTrack(rt.id, false);
      App.selectedRegionId = rid;
      this.renderRegions(); Inspector.render();

      const lx = e.clientX - regEl.getBoundingClientRect().left;
      const rw = regEl.offsetWidth;
      const inLoop = e.target.classList.contains('rg-loop');
      if (inLoop) { this.dragLoop(e, r); return; }
      if (lx < 7)        { this.dragResize(e, r, 'l'); return; }
      if (lx > rw - 7)   { this.dragResize(e, r, 'r'); return; }
      this.dragMove(e, e.altKey);
      return;
    }

    /* 空き領域: マーキー選択 or 再生ヘッド移動 */
    if (!(e.shiftKey || U.cmd(e))) { this.selRegions.clear(); this.renderRegions(); Inspector.render(); }
    if (track) this.selectTrack(track.id, false);
    this.marquee(e, rect, gw);
  },

  marquee(e, rect, gw) {
    const mq = U.$('#marquee');
    const x0 = e.clientX - rect.left + gw.scrollLeft, y0 = e.clientY - rect.top + gw.scrollTop;
    let moved = false;
    U.drag(e, (dx, dy, ev) => {
      moved = true;
      const x1 = ev.clientX - rect.left + gw.scrollLeft, y1 = ev.clientY - rect.top + gw.scrollTop;
      const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      mq.classList.remove('hidden');
      mq.style.cssText = 'left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;';
      /* ヒットテスト */
      this.selRegions.clear();
      const { tops } = this.trackTops();
      Project.data.tracks.forEach((tr, ti) => {
        const ty = tops[ti], th = tr.height;
        if (ty + th < t || ty > t + h) return;
        tr.regions.forEach(r => {
          const rx = this.beatToX(r.start), rw2 = r.length * (1 + r.loop) * this.pxPerBeat;
          if (rx + rw2 >= l && rx <= l + w) this.selRegions.add(r.id);
        });
      });
      this.renderRegions();
    }, (ev) => {
      mq.classList.add('hidden');
      if (!moved) {
        const b = this.snapBeat(this.xToBeat(x0));
        Transport.locate(b);
      } else Inspector.render();
    });
  },

  dragMove(e, duplicate) {
    const ppb = this.pxPerBeat;
    const items = Array.from(this.selRegions).map(id => Project.region(id)).filter(Boolean);
    if (!items.length) return;
    const orig = items.map(({ region, track }) => ({
      r: region, t: track, start: region.start, ti: Project.data.tracks.indexOf(track)
    }));
    const avgH = this.avgHeight();
    let did = false;
    U.drag(e, (dx, dy) => {
      if (!did) { Project.snapshot(duplicate ? 'リージョン複製' : 'リージョン移動'); did = true;
        if (duplicate) {
          orig.forEach(o => {
            const c = JSON.parse(JSON.stringify(o.r)); c.id = U.uid('rgn');
            c.notes.forEach(n => n.id = U.uid('n'));
            o.t.regions.push(c);
          });
        }
      }
      const db = this.snap ? Math.round((dx / ppb) / this.snap) * this.snap : dx / ppb;
      const dt = Math.round(dy / avgH);
      orig.forEach(o => {
        o.r.start = Math.max(0, o.start + db);
        const ni = U.clamp(o.ti + dt, 0, Project.data.tracks.length - 1);
        const nt = Project.data.tracks[ni];
        if (nt !== o.t) {
          const cur = Project.region(o.r.id);
          if (cur) { cur.track.regions.splice(cur.track.regions.indexOf(o.r), 1); nt.regions.push(o.r); }
        }
      });
      this.renderRegions();
    }, () => { if (did) { App.refreshAll(); } });
  },

  dragResize(e, r, side) {
    const ppb = this.pxPerBeat;
    const s0 = r.start, l0 = r.length;
    let did = false;
    U.drag(e, dx => {
      if (!did) { Project.snapshot('リージョン長さ変更'); did = true; }
      const db = this.snap ? Math.round((dx / ppb) / this.snap) * this.snap : dx / ppb;
      if (side === 'r') r.length = Math.max(this.snap || 0.25, l0 + db);
      else {
        const ns = Math.max(0, Math.min(s0 + db, s0 + l0 - (this.snap || 0.25)));
        r.start = ns; r.length = l0 + (s0 - ns);
      }
      this.renderRegions();
    }, () => { if (did) App.refreshAll(); }, 'ew-resize');
  },

  dragLoop(e, r) {
    const ppb = this.pxPerBeat;
    const l0 = r.loop || 0;
    let did = false;
    U.drag(e, dx => {
      if (!did) { Project.snapshot('ループ回数変更'); did = true; }
      r.loop = U.clamp(l0 + Math.round(dx / (r.length * ppb)), 0, 128);
      this.renderRegions();
    }, () => { if (did) App.refreshAll(); }, 'ew-resize');
  },

  createRegion(track, beat) {
    Project.snapshot('リージョン作成');
    const sig = Project.data.sigNum;
    const start = Math.floor(beat / sig) * sig;
    const r = newRegion(track.id, start, sig, '新規リージョン');
    track.regions.push(r);
    this.selRegions.clear(); this.selRegions.add(r.id);
    App.selectedRegionId = r.id;
    App.refreshAll();
  },

  splitRegion(track, r, at) {
    const end = r.start + r.length * (1 + r.loop);
    if (at <= r.start + 0.01 || at >= end - 0.01) return;
    Project.snapshot('リージョン分割');
    /* ループを実体化 */
    const flat = [];
    for (let k = 0; k <= (r.loop || 0); k++)
      r.notes.forEach(n => flat.push(Object.assign({}, n, { id: U.uid('n'), start: n.start + k * r.length })));
    const totalLen = r.length * (1 + r.loop);
    const rel = at - r.start;
    const a = newRegion(track.id, r.start, rel, r.name);
    const b = newRegion(track.id, at, totalLen - rel, r.name);
    a.transpose = b.transpose = r.transpose;
    flat.forEach(n => {
      if (n.start < rel) { const c = Object.assign({}, n); c.length = Math.min(n.length, rel - n.start); a.notes.push(c); }
      else { const c = Object.assign({}, n); c.start = n.start - rel; b.notes.push(c); }
    });
    const i = track.regions.indexOf(r);
    track.regions.splice(i, 1, a, b);
    this.selRegions.clear(); this.selRegions.add(b.id);
    App.refreshAll();
  },

  glueSelected(track) {
    const ids = Array.from(this.selRegions);
    const items = ids.map(id => Project.region(id)).filter(x => x && x.track === track).map(x => x.region);
    if (items.length < 2) { U.toast('同じトラックのリージョンを2つ以上選択してください'); return; }
    Project.snapshot('リージョン結合');
    items.sort((a, b) => a.start - b.start);
    const start = items[0].start;
    let end = 0;
    items.forEach(r => end = Math.max(end, r.start + r.length * (1 + r.loop)));
    const merged = newRegion(track.id, start, end - start, items[0].name);
    items.forEach(r => {
      for (let k = 0; k <= (r.loop || 0); k++)
        r.notes.forEach(n => merged.notes.push(Object.assign({}, n, {
          id: U.uid('n'), start: n.start + k * r.length + (r.start - start), pitch: n.pitch + (r.transpose || 0)
        })));
    });
    items.forEach(r => track.regions.splice(track.regions.indexOf(r), 1));
    track.regions.push(merged);
    this.selRegions.clear(); this.selRegions.add(merged.id);
    App.refreshAll();
  },

  /* ── ルーラ操作 ── */
  onRulerMouseDown(e) {
    const rw = U.$('#ruler-wrap'), gw = U.$('#grid-wrap');
    const rect = rw.getBoundingClientRect();
    const xAt = ev => ev.clientX - rect.left + gw.scrollLeft;
    const p = Project.data;

    if (e.offsetY < 10) {          /* サイクル帯のドラッグ */
      const b0 = this.snapBeat(this.xToBeat(xAt(e)));
      Project.snapshot('サイクル範囲');
      p.cycle.on = true; p.cycle.start = b0; p.cycle.end = b0 + p.sigNum;
      U.$('#tp-cycle').classList.add('active');
      U.drag(e, (dx, dy, ev) => {
        const b1 = this.snapBeat(this.xToBeat(xAt(ev)));
        p.cycle.start = Math.min(b0, b1);
        p.cycle.end = Math.max(b0 + (this.snap || 0.25), Math.max(b0, b1));
        this.drawRuler(); this.updateCycleZone();
      }, () => { this.drawRuler(); this.updateCycleZone(); });
      return;
    }
    /* スクラブ */
    const seek = ev => Transport.locate(this.snapBeat(this.xToBeat(xAt(ev))));
    seek(e);
    U.drag(e, (dx, dy, ev) => {
      const b = this.snapBeat(this.xToBeat(xAt(ev)));
      Transport.positionBeats = b; App.onPositionChange();
    }, null, 'ew-resize');
  },

  rulerContext(e) {
    const gw = U.$('#grid-wrap');
    const rect = U.$('#ruler-wrap').getBoundingClientRect();
    const beat = this.snapBeat(this.xToBeat(e.clientX - rect.left + gw.scrollLeft));
    App.contextMenu(e, [
      { label: 'ここにマーカーを作成', fn: () => {
          Project.snapshot('マーカー作成');
          Project.data.markers.push({ pos: beat, name: 'マーカー ' + (Project.data.markers.length + 1) });
          this.drawRuler();
        } },
      { label: '近くのマーカーを削除', fn: () => {
          const ms = Project.data.markers;
          let bi = -1, bd = 1e9;
          ms.forEach((m, i) => { const d = Math.abs(m.pos - beat); if (d < bd) { bd = d; bi = i; } });
          if (bi >= 0 && bd < Project.data.sigNum) { Project.snapshot('マーカー削除'); ms.splice(bi, 1); this.drawRuler(); }
        } },
      { sep: true },
      { label: 'サイクルをオン / オフ', fn: () => App.toggleCycle() },
      { label: '選択リージョンにサイクルを合わせる', fn: () => App.cycleToSelection() }
    ]);
  },

  onGridContext(e) {
    const regEl = e.target.closest('.region');
    e.preventDefault();
    if (regEl) {
      const f = Project.region(regEl.dataset.id);
      if (f) { if (!this.selRegions.has(f.region.id)) { this.selRegions.clear(); this.selRegions.add(f.region.id); this.renderRegions(); }
               App.regionContextMenu(e, f.region, f.track); }
      return;
    }
    const gw = U.$('#grid-wrap'), rect = gw.getBoundingClientRect();
    const y = e.clientY - rect.top + gw.scrollTop;
    const beat = this.snapBeat(this.xToBeat(e.clientX - rect.left + gw.scrollLeft));
    const ti = this.trackAtY(y);
    const track = ti >= 0 ? Project.data.tracks[ti] : null;
    App.contextMenu(e, [
      { label: '空のリージョンを作成', dis: !track, fn: () => this.createRegion(track, beat) },
      { label: 'ペースト', dis: !App.clipboard, fn: () => App.paste(track, beat) },
      { sep: true },
      { label: 'トラックを追加…', fn: () => App.addTrackDialog() }
    ]);
  },

  /* ── 再生ヘッド / サイクル表示 ── */
  updatePlayhead() {
    const b = Transport.isPlaying() ? Transport.now() : Transport.positionBeats;
    U.$('#playhead').style.left = this.beatToX(b) + 'px';
  },
  updateCycleZone() {
    const p = Project.data, z = U.$('#cycle-zone');
    if (!p.cycle.on) { z.style.display = 'none'; return; }
    z.style.display = 'block';
    z.style.left = this.beatToX(p.cycle.start) + 'px';
    z.style.width = this.beatToX(p.cycle.end - p.cycle.start) + 'px';
  },

  /* 再生ヘッドが見えるようスクロール追従 */
  followPlayhead() {
    const gw = U.$('#grid-wrap');
    const x = this.beatToX(Transport.now());
    const l = gw.scrollLeft, w = gw.clientWidth;
    if (x < l + 40 || x > l + w - 80) gw.scrollLeft = Math.max(0, x - w * 0.32);
  }
};

window.Arrange = Arrange;
