/* ══════════════════════════════════════════════════════════════
   waveeditor.js — 波形エディタ (オーディオファイルの表示・加工)
   ══════════════════════════════════════════════════════════════ */
'use strict';

const WaveEditor = {
  assetId: null,
  regionId: null,
  pxPerSec: 120,
  selStart: 0, selEnd: 0,      /* サンプル単位 */
  undoStack: [],
  redoStack: [],
  _inited: false,
  _preview: null,

  init() {
    const sc = U.$('#we-scroll');
    sc.addEventListener('scroll', () => this.draw());
    sc.addEventListener('mousedown', e => this.onMouseDown(e));
    sc.addEventListener('wheel', e => {
      if (U.cmd(e)) {
        e.preventDefault();
        const before = (sc.scrollLeft + e.offsetX) / this.pxPerSec;
        this.setZoom(this.pxPerSec * (e.deltaY < 0 ? 1.2 : 1 / 1.2));
        sc.scrollLeft = before * this.pxPerSec - e.offsetX;
        this.draw();
      }
    }, { passive: false });

    const B = (id, fn) => { const el = U.$(id); if (el) el.onclick = fn; };
    B('#we-zoom-in',  () => this.setZoom(this.pxPerSec * 1.5));
    B('#we-zoom-out', () => this.setZoom(this.pxPerSec / 1.5));
    B('#we-zoom-fit', () => this.zoomFit());
    B('#we-sel-all',  () => { const b = this.buffer(); if (b) { this.selStart = 0; this.selEnd = b.length; this.draw(); } });
    B('#we-play',     () => this.playSelection());
    B('#we-stop',     () => this.stopPreview());
    B('#we-normalize', () => this.apply('ノーマライズ', b => AudioFX.normalize(b, this.s(), this.e(), -0.3)));
    B('#we-gain',     () => this.gainDialog());
    B('#we-fadein',   () => this.apply('フェードイン', b => AudioFX.fadeIn(b, this.s(), this.e())));
    B('#we-fadeout',  () => this.apply('フェードアウト', b => AudioFX.fadeOut(b, this.s(), this.e())));
    B('#we-reverse',  () => this.apply('リバース', b => AudioFX.reverse(b, this.s(), this.e())));
    B('#we-silence',  () => this.apply('無音化', b => AudioFX.silence(b, this.s(), this.e())));
    B('#we-invert',   () => this.apply('位相反転', b => AudioFX.invert(b, this.s(), this.e())));
    B('#we-dc',       () => this.apply('DC オフセット除去', b => AudioFX.removeDC(b, this.s(), this.e())));
    B('#we-trim',     () => this.apply('選択範囲で切り出し', b => AudioFX.crop(b, this.s(), this.e()), true));
    B('#we-cut',      () => this.apply('選択範囲を削除', b => AudioFX.cut(b, this.s(), this.e()), true));
    B('#we-pitch',    () => this.pitchDialog());
    B('#we-resample', () => this.resampleDialog());
    B('#we-undo',     () => this.undo());
    B('#we-redo',     () => this.redo());
    B('#we-export',   () => this.exportDialog());
    this._inited = true;
  },

  asset() { return this.assetId ? AudioPool.get(this.assetId) : null; },
  buffer() { const a = this.asset(); return a && a.buffer; },
  s() { return Math.min(this.selStart, this.selEnd) | 0; },
  e() { const b = this.buffer(); const v = Math.max(this.selStart, this.selEnd) | 0; return b ? Math.min(v, b.length) : v; },
  hasSel() { return this.e() - this.s() > 1; },

  open(regionOrAssetId) {
    const f = Project.region(regionOrAssetId);
    if (f && f.region.type === 'audio') { this.regionId = f.region.id; this.assetId = f.region.audioId; }
    else if (AudioPool.get(regionOrAssetId)) { this.assetId = regionOrAssetId; this.regionId = null; }
    else return;
    const b = this.buffer();
    this.selStart = 0; this.selEnd = b ? b.length : 0;
    this.undoStack = []; this.redoStack = [];
    App.showEditor('wave');
    this.zoomFit();
  },

  setZoom(v) {
    const b = this.buffer();
    const min = b ? Math.max(0.5, (U.$('#we-scroll').clientWidth - 4) / b.duration / 4) : 1;
    this.pxPerSec = U.clamp(v, min, 40000);
    this.draw();
  },
  zoomFit() {
    const b = this.buffer(); if (!b) { this.draw(); return; }
    const w = U.$('#we-scroll').clientWidth || 800;
    this.pxPerSec = Math.max(1, (w - 6) / b.duration);
    U.$('#we-scroll').scrollLeft = 0;
    this.draw();
  },

  /* ── 描画 ── */
  draw() {
    if (!this._inited) return;
    const sc = U.$('#we-scroll');
    const a = this.asset();
    const info = U.$('#we-info');
    const spacer = U.$('#we-spacer');
    const cv = U.$('#we-canvas');
    const w = sc.clientWidth, h = sc.clientHeight;
    if (w <= 0 || h <= 0) return;

    if (!a) {
      spacer.style.width = '100%';
      const ctx = U.fitCanvas(cv, w, h);
      cv.style.left = '0px';
      ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#5c6472'; ctx.font = '12px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('オーディオリージョンを選択するか、ファイルをドラッグ＆ドロップしてください', w / 2, h / 2);
      ctx.textAlign = 'left';
      info.textContent = '';
      return;
    }

    const buf = a.buffer;
    const total = buf.duration * this.pxPerSec;
    spacer.style.width = Math.max(total, w) + 'px';
    cv.style.left = sc.scrollLeft + 'px';
    const ctx = U.fitCanvas(cv, w, h);
    const sx = sc.scrollLeft;

    const RULER = 18;
    const nCh = buf.numberOfChannels;
    const chH = Math.max(24, (h - RULER) / nCh);

    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, w, h);

    /* 選択範囲 */
    const s0 = this.s() / buf.sampleRate * this.pxPerSec - sx;
    const s1 = this.e() / buf.sampleRate * this.pxPerSec - sx;
    if (this.hasSel()) {
      ctx.fillStyle = 'rgba(90,190,255,.13)';
      ctx.fillRect(s0, RULER, s1 - s0, h - RULER);
    }

    /* ルーラ */
    ctx.fillStyle = '#161b24'; ctx.fillRect(0, 0, w, RULER);
    ctx.strokeStyle = '#2a323f'; ctx.beginPath(); ctx.moveTo(0, RULER + .5); ctx.lineTo(w, RULER + .5); ctx.stroke();
    let step = 1;
    const steps = [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120, 300];
    for (const st of steps) { if (st * this.pxPerSec >= 62) { step = st; break; } step = steps[steps.length - 1]; }
    ctx.font = '9px ' + getComputedStyle(document.body).fontFamily;
    ctx.textBaseline = 'middle';
    const t0 = Math.floor(sx / this.pxPerSec / step) * step;
    for (let t = t0; t * this.pxPerSec - sx < w; t += step) {
      const x = Math.round(t * this.pxPerSec - sx) + .5;
      ctx.strokeStyle = '#3c4756';
      ctx.beginPath(); ctx.moveTo(x, 4); ctx.lineTo(x, RULER); ctx.stroke();
      ctx.fillStyle = '#8b97a8';
      ctx.fillText(step < 1 ? t.toFixed(3) + 's' : U.smpte(t).slice(3), x + 3, 9);
    }

    /* 波形 */
    const peaks = a.peaks;
    const bucket = peaks.bucket;
    const samplesPerPx = buf.sampleRate / this.pxPerSec;
    for (let c = 0; c < nCh; c++) {
      const top = RULER + c * chH;
      const mid = top + chH / 2;
      const amp = chH / 2 - 3;

      ctx.fillStyle = c % 2 ? '#0f131a' : '#0d1016';
      ctx.fillRect(0, top, w, chH);
      ctx.strokeStyle = '#232c39';
      ctx.beginPath(); ctx.moveTo(0, mid + .5); ctx.lineTo(w, mid + .5); ctx.stroke();
      ctx.strokeStyle = '#1b222c';
      [0.5, -0.5].forEach(v => { const y = mid - v * amp; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });

      const grd = ctx.createLinearGradient(0, top, 0, top + chH);
      grd.addColorStop(0, '#4fd6ff'); grd.addColorStop(0.5, '#2f9fe0'); grd.addColorStop(1, '#4fd6ff');
      ctx.fillStyle = grd;

      if (samplesPerPx >= bucket) {
        /* ピークデータから描く (ズームアウト時) */
        const pk = peaks.channels[c];
        const perPx = samplesPerPx / bucket;
        for (let x = 0; x < w; x++) {
          const i0 = Math.floor((sx + x) * perPx), i1 = Math.min(pk.min.length, Math.floor((sx + x + 1) * perPx));
          if (i0 >= pk.min.length) break;
          let lo = 1, hi = -1;
          for (let i = i0; i < Math.max(i0 + 1, i1); i++) { if (pk.min[i] < lo) lo = pk.min[i]; if (pk.max[i] > hi) hi = pk.max[i]; }
          const y0 = mid - hi * amp, y1 = mid - lo * amp;
          ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
        }
      } else {
        /* サンプル単位で描く (ズームイン時) */
        const d = buf.getChannelData(c);
        ctx.strokeStyle = '#4fd6ff'; ctx.lineWidth = 1;
        ctx.beginPath();
        const startSample = Math.floor(sx * samplesPerPx);
        for (let x = 0; x <= w; x++) {
          const i = startSample + Math.floor(x * samplesPerPx);
          if (i >= d.length) break;
          const y = mid - d[i] * amp;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (samplesPerPx < 0.34) {
          ctx.fillStyle = '#8fe8ff';
          for (let x = 0; x <= w; x++) {
            const i = startSample + Math.floor(x * samplesPerPx);
            if (i >= d.length) break;
            if (x % Math.max(1, Math.round(1 / samplesPerPx)) === 0)
              ctx.fillRect(x - 1.5, mid - d[i] * amp - 1.5, 3, 3);
          }
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '9px sans-serif';
      ctx.fillText(nCh === 1 ? 'MONO' : (c === 0 ? 'L' : 'R'), 5, top + 9);
      ctx.strokeStyle = '#000';
      ctx.beginPath(); ctx.moveTo(0, top + chH - .5); ctx.lineTo(w, top + chH - .5); ctx.stroke();
    }

    /* 選択範囲の境界線 */
    if (this.hasSel()) {
      ctx.strokeStyle = '#5ac8ff'; ctx.lineWidth = 1;
      [s0, s1].forEach(x => { ctx.beginPath(); ctx.moveTo(x + .5, RULER); ctx.lineTo(x + .5, h); ctx.stroke(); });
    }

    /* プレビュー再生ヘッド */
    if (this._preview && this._preview.startedAt != null) {
      const el = (Engine.ctx.currentTime - this._preview.startedAt) * (this._preview.rate || 1) + this._preview.offset;
      const x = el * this.pxPerSec - sx;
      if (x >= 0 && x <= w) {
        ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.moveTo(x + .5, RULER); ctx.lineTo(x + .5, h); ctx.stroke();
      }
    }

    /* 情報表示 */
    const sel = this.hasSel()
      ? (this.e() - this.s()) / buf.sampleRate
      : 0;
    const m = a.meta || {};
    U.$('#we-info').innerHTML =
      '<b>' + a.name + '</b>' +
      ' <span class="we-dim">' + (m.format || 'PCM') + ' / ' +
      (m.origRate ? (m.origRate / 1000).toFixed(m.origRate % 1000 ? 1 : 0) + ' kHz' : '') +
      (m.origBits ? ' / ' + m.origBits + ' bit' : '') +
      ' / ' + (buf.numberOfChannels === 1 ? 'モノラル' : 'ステレオ') + '</span>' +
      ' <span class="we-dim">現在: ' + (buf.sampleRate / 1000).toFixed(buf.sampleRate % 1000 ? 1 : 0) + ' kHz · ' +
      U.smpte(buf.duration).slice(3) + '</span>' +
      (sel ? ' <span class="we-sel-info">選択 ' + sel.toFixed(3) + ' 秒 (' + (this.e() - this.s()).toLocaleString() + ' サンプル)</span>' : '');
  },

  /* ── マウス操作 ── */
  onMouseDown(e) {
    const buf = this.buffer(); if (!buf) return;
    const sc = U.$('#we-scroll');
    const rect = sc.getBoundingClientRect();
    const toSample = ev => U.clamp(Math.round((ev.clientX - rect.left + sc.scrollLeft) / this.pxPerSec * buf.sampleRate), 0, buf.length);
    const a0 = toSample(e);
    this.selStart = a0; this.selEnd = a0;
    this.draw();
    U.drag(e, (dx, dy, ev) => { this.selEnd = toSample(ev); this.draw(); },
      (ev, moved) => { if (!moved) { this.selStart = 0; this.selEnd = buf.length; this.draw(); } });
  },

  /* ── 編集適用 ── */
  apply(label, fn, changesLength) {
    const a = this.asset(); if (!a) { U.toast('オーディオが選択されていません'); return; }
    if (!this.hasSel() && !changesLength) { this.selStart = 0; this.selEnd = a.buffer.length; }
    this.pushUndo();
    const before = a.buffer.length;
    const nb = fn(a.buffer);
    AudioPool.replace(this.assetId, nb);
    if (changesLength) {
      const ratio = nb.length / Math.max(1, before);
      this.retimeRegions(nb);
      this.selStart = 0; this.selEnd = Math.min(this.selEnd, nb.length);
    }
    this.draw();
    Arrange.renderRegions();
    U.toast(label + ' を適用しました');
  },
  /* バッファ長が変わったらリージョン長も追従させる */
  retimeRegions(buf) {
    const beats = buf.duration * Project.data.tempo / 60;
    Project.data.tracks.forEach(t => t.regions.forEach(r => {
      if (r.type === 'audio' && r.audioId === this.assetId) {
        r.length = Math.max(0.05, beats - (r.offset || 0) * Project.data.tempo / 60);
        r.offset = Math.min(r.offset || 0, buf.duration - 0.01);
      }
    }));
  },

  pushUndo() {
    const a = this.asset(); if (!a) return;
    this.undoStack.push(AudioFX.clone(a.buffer));
    if (this.undoStack.length > 12) this.undoStack.shift();
    this.redoStack.length = 0;
  },
  undo() {
    if (!this.undoStack.length) { U.toast('取り消せる波形編集がありません'); return; }
    const a = this.asset(); if (!a) return;
    this.redoStack.push(AudioFX.clone(a.buffer));
    AudioPool.replace(this.assetId, this.undoStack.pop());
    this.retimeRegions(this.buffer());
    this.draw(); Arrange.renderRegions();
    U.toast('波形編集を取り消しました');
  },
  redo() {
    if (!this.redoStack.length) { U.toast('やり直せる波形編集がありません'); return; }
    const a = this.asset(); if (!a) return;
    this.undoStack.push(AudioFX.clone(a.buffer));
    AudioPool.replace(this.assetId, this.redoStack.pop());
    this.retimeRegions(this.buffer());
    this.draw(); Arrange.renderRegions();
  },

  /* ── プレビュー再生 ── */
  playSelection() {
    const buf = this.buffer(); if (!buf) return;
    this.stopPreview();
    const s = this.hasSel() ? this.s() : 0;
    const e = this.hasSel() ? this.e() : buf.length;
    const src = Engine.ctx.createBufferSource();
    src.buffer = buf;
    const g = Engine.ctx.createGain(); g.gain.value = 0.9;
    src.connect(g); g.connect(Engine.graph.masterIn);
    const off = s / buf.sampleRate, dur = (e - s) / buf.sampleRate;
    src.start(Engine.ctx.currentTime, off, dur);
    this._preview = { src, startedAt: Engine.ctx.currentTime, offset: off, rate: 1 };
    src.onended = () => { if (this._preview && this._preview.src === src) this._preview = null; };
  },
  stopPreview() {
    if (this._preview) { try { this._preview.src.stop(); } catch (e) {} this._preview = null; }
  },

  /* ── ダイアログ ── */
  gainDialog() {
    const a = this.asset(); if (!a) return;
    Modal.show('ゲイン調整', body => {
      body.__db = 0;
      const cur = AudioFX.peakOf(a.buffer, this.s(), this.e());
      body.appendChild(U.el('p', null, '現在のピーク: ' + (cur > 0 ? (20 * Math.log10(cur)).toFixed(2) : '-∞') + ' dBFS'));
      body.appendChild(ipRange('ゲイン (dB)', 0, -48, 24, 0.1, v => body.__db = v, v => (v > 0 ? '+' : '') + v.toFixed(1) + ' dB'));
    }, [
      { label: 'キャンセル' },
      { label: '適用', primary: true, fn: body => {
          const mul = Math.pow(10, body.__db / 20);
          this.apply('ゲイン ' + body.__db.toFixed(1) + 'dB', b => AudioFX.gain(b, this.s(), this.e(), mul));
        } }
    ]);
  },
  pitchDialog() {
    Modal.show('ピッチ / 速度を変更', body => {
      body.__semi = 0;
      body.appendChild(ipRange('半音', 0, -24, 24, 1, v => body.__semi = v, v => (v > 0 ? '+' : '') + v + ' 半音'));
      body.appendChild(U.el('p', null,
        'テープ方式のバリスピードです。ピッチと再生速度が同時に変化します。'));
    }, [
      { label: 'キャンセル' },
      { label: '適用', primary: true, fn: async body => {
          const a = this.asset(); if (!a) return;
          this.pushUndo();
          U.toast('処理中…', 20000);
          const nb = await AudioFX.pitchShift(a.buffer, body.__semi);
          AudioPool.replace(this.assetId, nb);
          this.retimeRegions(nb);
          U.$('#toast-wrap').innerHTML = '';
          this.draw(); Arrange.renderRegions();
          U.toast('ピッチを ' + body.__semi + ' 半音変更しました');
        } }
    ]);
  },
  resampleDialog() {
    const a = this.asset(); if (!a) return;
    Modal.show('サンプルレート変換', body => {
      body.__rate = 48000;
      body.appendChild(U.el('p', null, '現在: ' + a.buffer.sampleRate + ' Hz'));
      body.appendChild(ipSelect('変換先', '48000',
        [{ value: '44100', label: '44.1 kHz' }, { value: '48000', label: '48 kHz' },
         { value: '88200', label: '88.2 kHz' }, { value: '96000', label: '96 kHz' }],
        v => body.__rate = +v));
    }, [
      { label: 'キャンセル' },
      { label: '変換', primary: true, fn: async body => {
          this.pushUndo();
          U.toast('変換中…', 20000);
          const nb = await AudioFX.resample(a.buffer, body.__rate);
          AudioPool.replace(this.assetId, nb);
          U.$('#toast-wrap').innerHTML = '';
          this.draw();
          U.toast(body.__rate + ' Hz に変換しました');
        } }
    ]);
  },
  exportDialog() {
    const a = this.asset(); if (!a) { U.toast('オーディオが選択されていません'); return; }
    App.exportBufferDialog(a.buffer, a.name, this.hasSel() ? { s: this.s(), e: this.e() } : null);
  }
};

window.WaveEditor = WaveEditor;
