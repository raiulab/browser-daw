/* ══════════════════════════════════════════════════════════════
   pianoroll.js — ピアノロールエディタ
   ══════════════════════════════════════════════════════════════ */
'use strict';

const PianoRoll = {
  regionId: null,
  ppb: 80,
  noteH: 12,
  quant: 0.25,
  vel: 96,
  sel: new Set(),
  _inited: false,

  init() {
    const sc = U.$('#pr-scroll');
    sc.addEventListener('scroll', () => this.onScroll());
    sc.addEventListener('mousedown', e => this.onMouseDown(e));
    sc.addEventListener('contextmenu', e => this.onContext(e));
    sc.addEventListener('wheel', e => {
      if (U.cmd(e)) { e.preventDefault(); this.setZoom(this.ppb * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }
      else if (e.altKey) { e.preventDefault(); this.noteH = U.clamp(this.noteH + (e.deltaY < 0 ? 1 : -1), 5, 30); this.render(); }
    }, { passive: false });

    U.$('#pr-keys').addEventListener('mousedown', e => this.onKeyClick(e));
    U.$('#pr-ruler').parentElement.addEventListener('mousedown', e => {
      const sc2 = U.$('#pr-scroll');
      const rect = e.currentTarget.getBoundingClientRect();
      const f = Project.region(this.regionId); if (!f) return;
      const b = f.region.start + (e.clientX - rect.left + sc2.scrollLeft) / this.ppb;
      Transport.locate(Math.max(0, b));
    });

    U.$('#pr-zoom').addEventListener('input', e => this.setZoom(+e.target.value));
    U.$('#pr-quant').addEventListener('change', e => this.quant = +e.target.value);
    U.$('#pr-vel').addEventListener('input', e => {
      this.vel = +e.target.value; U.$('#pr-velval').textContent = this.vel;
      if (this.sel.size) {
        const f = Project.region(this.regionId); if (!f) return;
        f.region.notes.forEach(n => { if (this.sel.has(n.id)) n.vel = this.vel; });
        this.render();
      }
    });
    U.$('#pr-do-quant').onclick = () => this.quantize();
    U.$('#pr-transpose-up').onclick = () => this.transpose(1);
    U.$('#pr-transpose-dn').onclick = () => this.transpose(-1);
    U.$('#pr-oct-up').onclick = () => this.transpose(12);
    U.$('#pr-oct-dn').onclick = () => this.transpose(-12);

    U.$('#pr-velcanvas').parentElement.addEventListener('mousedown', e => this.onVelMouseDown(e));
    this._inited = true;
  },

  setZoom(v) { this.ppb = U.clamp(v, 12, 400); U.$('#pr-zoom').value = U.clamp(Math.round(this.ppb), 24, 260); this.render(); },

  open(regionId) {
    this.regionId = regionId;
    this.sel.clear();
    App.showEditor('pianoroll');
    this.render();
    /* ノート範囲へ縦スクロール */
    const f = Project.region(regionId);
    if (f && f.region.notes.length) {
      let lo = 127, hi = 0;
      f.region.notes.forEach(n => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
      const mid = (lo + hi) / 2;
      const sc = U.$('#pr-scroll');
      sc.scrollTop = U.clamp((127 - mid) * this.noteH - sc.clientHeight / 2, 0, 128 * this.noteH);
      this.onScroll();
    }
  },

  region() { const f = Project.region(this.regionId); return f ? f.region : null; },
  track()  { const f = Project.region(this.regionId); return f ? f.track : null; },

  onScroll() { this.drawKeys(); this.drawRuler(); this.drawGrid(); this.drawVel(); this.updatePlayhead(); },

  render() {
    if (!this._inited) return;
    const r = this.region();
    const info = U.$('#editor-info');
    if (!r) {
      U.$('#pr-notes').innerHTML = '';
      info.textContent = 'リージョン未選択';
      this.drawKeys(); this.drawGrid(); this.drawRuler(); this.drawVel();
      return;
    }
    const t = this.track();
    info.textContent = t.name + ' — ' + r.name + '  (' + r.notes.length + ' ノート)';
    U.$('#pr-hint').textContent = Instruments.isDrum(t.instrument) ? 'ドラム: ステップシーケンサも利用できます' : '';

    const sc = U.$('#pr-scroll');
    const W = Math.max(r.length * this.ppb, sc.clientWidth);
    const H = 128 * this.noteH;
    const layer = U.$('#pr-notes');
    layer.style.width = W + 'px'; layer.style.height = H + 'px';
    layer.innerHTML = '';

    const drum = Instruments.isDrum(t.instrument);
    r.notes.forEach(n => {
      const d = U.el('div', 'note' + (this.sel.has(n.id) ? ' selected' : ''));
      d.dataset.id = n.id;
      d.style.left = (n.start * this.ppb) + 'px';
      d.style.top = ((127 - n.pitch) * this.noteH) + 'px';
      d.style.width = Math.max(3, n.length * this.ppb - 1) + 'px';
      d.style.height = (this.noteH - 1) + 'px';
      if (!this.sel.has(n.id)) {
        const a = 0.35 + (n.vel / 127) * 0.65;
        d.style.background = 'linear-gradient(rgba(140,205,255,' + a + '),rgba(52,130,205,' + a + '))';
      }
      d.title = U.noteName(n.pitch) + '  vel ' + n.vel;
      if (!drum) d.appendChild(U.el('div', 'nh'));
      layer.appendChild(d);
    });
    U.$('#pr-playhead').style.height = H + 'px';
    this.drawKeys(); this.drawGrid(); this.drawRuler(); this.drawVel(); this.updatePlayhead();
  },

  /* ── 鍵盤 ── */
  drawKeys() {
    const sc = U.$('#pr-scroll');
    const wrap = U.$('.pr-keys-wrap');
    const h = wrap.clientHeight, w = 62;
    if (h <= 0) return;
    const cv = U.$('#pr-keys');
    const ctx = U.fitCanvas(cv, w, h);
    const sy = sc.scrollTop, nh = this.noteH;
    const t = this.track();
    const drum = t && Instruments.isDrum(t.instrument);

    ctx.fillStyle = '#1c1c20'; ctx.fillRect(0, 0, w, h);
    ctx.font = '9px sans-serif'; ctx.textBaseline = 'middle';
    const first = Math.floor(sy / nh), last = Math.ceil((sy + h) / nh);
    for (let i = first; i <= last; i++) {
      const pitch = 127 - i;
      if (pitch < 0 || pitch > 127) continue;
      const y = i * nh - sy;
      const black = U.isBlackKey(pitch);
      if (drum) {
        const dm = Instruments.DRUM_MAP.find(d => d.midi === pitch);
        ctx.fillStyle = dm ? '#3a4652' : '#232329';
        ctx.fillRect(0, y, w, nh - 1);
        if (dm && nh >= 8) { ctx.fillStyle = '#cfd8e2'; ctx.fillText(dm.name, 3, y + nh / 2); }
      } else {
        ctx.fillStyle = black ? '#232329' : '#d8d8de';
        ctx.fillRect(0, y, w, nh - 1);
        if (!black && nh >= 8) {
          ctx.fillStyle = '#4a4a52';
          if (pitch % 12 === 0 || nh >= 15) ctx.fillText(U.noteName(pitch), 3, y + nh / 2);
        }
      }
      ctx.fillStyle = '#0d0d0f'; ctx.fillRect(0, y + nh - 1, w, 1);
    }
  },

  onKeyClick(e) {
    const sc = U.$('#pr-scroll');
    const rect = U.$('#pr-keys').getBoundingClientRect();
    const i = Math.floor((e.clientY - rect.top + sc.scrollTop) / this.noteH);
    const pitch = U.clamp(127 - i, 0, 127);
    const t = this.track();
    if (t && Engine.graph) {
      const inst = Engine.instrument(t.id);
      if (inst) inst.noteOn(pitch, Engine.ctx.currentTime, this.vel, 0.42);
    }
  },

  /* ── グリッド ── */
  drawGrid() {
    const sc = U.$('#pr-scroll');
    const w = sc.clientWidth, h = sc.clientHeight;
    if (w <= 0 || h <= 0) return;
    const cv = U.$('#pr-grid');
    cv.style.left = sc.scrollLeft + 'px'; cv.style.top = sc.scrollTop + 'px';
    const ctx = U.fitCanvas(cv, w, h);
    const sx = sc.scrollLeft, sy = sc.scrollTop, nh = this.noteH, ppb = this.ppb;
    const p = Project.data, sig = p.sigNum;
    const t = this.track();
    const drum = t && Instruments.isDrum(t.instrument);

    /* 行 */
    const first = Math.floor(sy / nh), last = Math.ceil((sy + h) / nh);
    for (let i = first; i <= last; i++) {
      const pitch = 127 - i, y = i * nh - sy;
      if (drum) {
        const dm = Instruments.DRUM_MAP.find(d => d.midi === pitch);
        ctx.fillStyle = dm ? '#22262b' : '#1a1a1e';
      } else {
        ctx.fillStyle = U.isBlackKey(pitch) ? '#191a1e' : '#212127';
        if (pitch % 12 === 0) ctx.fillStyle = '#25252c';
      }
      ctx.fillRect(0, y, w, nh);
      ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, y + nh - 1, w, 1);
    }

    /* 縦線 */
    const b0 = sx / ppb, b1 = (sx + w) / ppb;
    const q = this.quant || 0.25;
    if (ppb * q > 6) {
      ctx.strokeStyle = 'rgba(255,255,255,.045)'; ctx.beginPath();
      for (let b = Math.floor(b0 / q) * q; b <= b1; b += q) {
        const x = Math.round(b * ppb - sx) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, h);
      }
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,.11)'; ctx.beginPath();
    for (let b = Math.ceil(b0); b <= b1; b++) {
      const x = Math.round(b * ppb - sx) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,.26)'; ctx.beginPath();
    const r = this.region();
    const ofs = r ? (r.start % sig) : 0;
    for (let b = Math.floor((b0 + ofs) / sig) * sig - ofs; b <= b1; b += sig) {
      const x = Math.round(b * ppb - sx) + .5; ctx.moveTo(x, 0); ctx.lineTo(x, h);
    }
    ctx.stroke();

    /* リージョン外を暗く */
    if (r) {
      const endX = r.length * ppb - sx;
      if (endX < w) { ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(endX, 0, w - endX, h); }
    }
  },

  drawRuler() {
    const wrap = U.$('.pr-ruler-wrap');
    const w = wrap.clientWidth, h = 22;
    if (w <= 0) return;
    const ctx = U.fitCanvas(U.$('#pr-ruler'), w, h);
    const sc = U.$('#pr-scroll'), sx = sc.scrollLeft, ppb = this.ppb;
    const p = Project.data, sig = p.sigNum;
    const r = this.region();
    const base = r ? r.start : 0;

    ctx.fillStyle = '#26262b'; ctx.fillRect(0, 0, w, h);
    ctx.font = '10px sans-serif'; ctx.textBaseline = 'middle';
    const b0 = sx / ppb, b1 = (sx + w) / ppb;
    let step = sig;
    while (step * ppb < 44) step *= 2;
    const off = ((base % sig) + sig) % sig;
    for (let b = Math.floor((b0 + off) / step) * step - off; b <= b1; b += step) {
      const x = Math.round(b * ppb - sx) + .5;
      ctx.strokeStyle = '#787885';
      ctx.beginPath(); ctx.moveTo(x, 6); ctx.lineTo(x, h); ctx.stroke();
      const barNo = Math.round((base + b) / sig) + 1;
      ctx.fillStyle = '#c8c8d2'; ctx.fillText(String(barNo), x + 4, 12);
    }
    if (ppb > 26) {
      ctx.strokeStyle = '#43434b';
      for (let b = Math.ceil(b0); b <= b1; b++) {
        const x = Math.round(b * ppb - sx) + .5;
        ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, h); ctx.stroke();
      }
    }
  },

  /* ── ベロシティレーン ── */
  drawVel() {
    const wrap = U.$('.pr-vel-wrap');
    const w = wrap.clientWidth, h = wrap.clientHeight;
    if (w <= 0 || h <= 0) return;
    const ctx = U.fitCanvas(U.$('#pr-velcanvas'), w, h);
    const sc = U.$('#pr-scroll'), sx = sc.scrollLeft, ppb = this.ppb;
    ctx.fillStyle = '#141417'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    [0.25, 0.5, 0.75].forEach(f => { const y = h * f; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); });
    ctx.fillStyle = '#5c5c66'; ctx.font = '8px sans-serif';
    ctx.fillText('VELOCITY', 3, 10);
    const r = this.region(); if (!r) return;
    r.notes.forEach(n => {
      const x = n.start * ppb - sx;
      if (x < -4 || x > w) return;
      const bh = (n.vel / 127) * (h - 6);
      ctx.fillStyle = this.sel.has(n.id) ? '#f0c040' : '#4a9ad8';
      ctx.fillRect(x, h - bh, 3, bh);
      ctx.fillStyle = this.sel.has(n.id) ? '#ffe9a8' : '#8ec8f0';
      ctx.fillRect(x, h - bh, 3, 2);
    });
  },

  onVelMouseDown(e) {
    const r = this.region(); if (!r) return;
    const wrap = U.$('.pr-vel-wrap');
    const rect = wrap.getBoundingClientRect();
    const sc = U.$('#pr-scroll');
    const h = wrap.clientHeight;
    const apply = ev => {
      const x = ev.clientX - rect.left + sc.scrollLeft;
      const y = ev.clientY - rect.top;
      const v = U.clamp(Math.round((1 - y / (h - 6)) * 127), 1, 127);
      let hit = null, best = 9;
      r.notes.forEach(n => { const d = Math.abs(n.start * this.ppb - x); if (d < best) { best = d; hit = n; } });
      if (hit) {
        if (this.sel.size && this.sel.has(hit.id)) r.notes.forEach(n => { if (this.sel.has(n.id)) n.vel = v; });
        else hit.vel = v;
        this.drawVel(); this.render();
      }
    };
    Project.snapshot('ベロシティ変更');
    apply(e);
    U.drag(e, (dx, dy, ev) => apply(ev), null, 'ns-resize');
  },

  /* ── マウス操作 ── */
  posFromEvent(e) {
    const sc = U.$('#pr-scroll');
    const rect = sc.getBoundingClientRect();
    const x = e.clientX - rect.left + sc.scrollLeft;
    const y = e.clientY - rect.top + sc.scrollTop;
    return { x, y, beat: x / this.ppb, pitch: U.clamp(127 - Math.floor(y / this.noteH), 0, 127) };
  },
  snapB(b) { return this.quant ? Math.round(b / this.quant) * this.quant : b; },

  onMouseDown(e) {
    if (e.button !== 0) return;
    const r = this.region(); if (!r) { U.toast('リージョンをダブルクリックして編集'); return; }
    const noteEl = e.target.closest('.note');
    const pos = this.posFromEvent(e);
    const tool = Arrange.tool;

    if (noteEl) {
      const n = r.notes.find(x => x.id === noteEl.dataset.id); if (!n) return;
      if (tool === 'eraser') { Project.snapshot('ノート削除'); r.notes.splice(r.notes.indexOf(n), 1); this.sel.delete(n.id); this.render(); App.refreshArrangeOnly(); return; }
      if (!this.sel.has(n.id)) {
        if (!(e.shiftKey || U.cmd(e))) this.sel.clear();
        this.sel.add(n.id);
      } else if (e.shiftKey || U.cmd(e)) { this.sel.delete(n.id); this.render(); return; }
      this.render();
      this.previewNote(n.pitch, n.vel);
      const lx = e.clientX - noteEl.getBoundingClientRect().left;
      if (lx > noteEl.offsetWidth - 6) this.dragLength(e, r);
      else this.dragNotes(e, r, e.altKey);
      return;
    }

    /* 空き領域 */
    if (tool === 'pencil' || e.altKey === false && U.cmd(e)) { this.addNote(r, pos); return; }
    if (!(e.shiftKey)) { this.sel.clear(); this.render(); }
    this.marquee(e, r);
  },

  addNote(r, pos) {
    Project.snapshot('ノート作成');
    const t = this.track();
    const drum = t && Instruments.isDrum(t.instrument);
    const len = drum ? Math.min(0.25, this.quant || 0.25) : (this.quant || 0.25);
    const n = newNote(pos.pitch, Math.max(0, this.snapB(pos.beat)), len, this.vel);
    r.notes.push(n);
    this.sel.clear(); this.sel.add(n.id);
    this.previewNote(n.pitch, n.vel);
    this.render(); App.refreshArrangeOnly();
  },

  previewNote(pitch, vel) {
    const t = this.track(); if (!t || !Engine.graph) return;
    const inst = Engine.instrument(t.id);
    if (inst) inst.noteOn(pitch, Engine.ctx.currentTime, vel || this.vel, 0.35);
  },

  dragNotes(e, r, duplicate) {
    const notes = r.notes.filter(n => this.sel.has(n.id));
    const orig = notes.map(n => ({ n, s: n.start, p: n.pitch }));
    let did = false;
    U.drag(e, (dx, dy) => {
      if (!did) {
        Project.snapshot(duplicate ? 'ノート複製' : 'ノート移動'); did = true;
        if (duplicate) {
          orig.forEach(o => { const c = Object.assign({}, o.n, { id: U.uid('n') }); r.notes.push(c); });
        }
      }
      const db = this.quant ? Math.round((dx / this.ppb) / this.quant) * this.quant : dx / this.ppb;
      const dp = -Math.round(dy / this.noteH);
      orig.forEach(o => {
        o.n.start = Math.max(0, o.s + db);
        o.n.pitch = U.clamp(o.p + dp, 0, 127);
      });
      this.render();
    }, () => { if (did) App.refreshArrangeOnly(); });
  },

  dragLength(e, r) {
    const notes = r.notes.filter(n => this.sel.has(n.id));
    const orig = notes.map(n => ({ n, l: n.length }));
    let did = false;
    U.drag(e, dx => {
      if (!did) { Project.snapshot('ノート長さ変更'); did = true; }
      const db = this.quant ? Math.round((dx / this.ppb) / this.quant) * this.quant : dx / this.ppb;
      orig.forEach(o => o.n.length = Math.max(0.03125, o.l + db));
      this.render();
    }, () => { if (did) App.refreshArrangeOnly(); }, 'ew-resize');
  },

  marquee(e, r) {
    const sc = U.$('#pr-scroll'), rect = sc.getBoundingClientRect();
    const mq = U.$('#pr-marquee');
    const x0 = e.clientX - rect.left + sc.scrollLeft, y0 = e.clientY - rect.top + sc.scrollTop;
    let moved = false;
    U.drag(e, (dx, dy, ev) => {
      moved = true;
      const x1 = ev.clientX - rect.left + sc.scrollLeft, y1 = ev.clientY - rect.top + sc.scrollTop;
      const l = Math.min(x0, x1), t = Math.min(y0, y1), w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      mq.classList.remove('hidden');
      mq.style.cssText = 'left:' + l + 'px;top:' + t + 'px;width:' + w + 'px;height:' + h + 'px;';
      this.sel.clear();
      r.notes.forEach(n => {
        const nx = n.start * this.ppb, nw = n.length * this.ppb;
        const ny = (127 - n.pitch) * this.noteH;
        if (nx + nw >= l && nx <= l + w && ny + this.noteH >= t && ny <= t + h) this.sel.add(n.id);
      });
      this.render();
    }, () => { mq.classList.add('hidden'); if (!moved) { this.sel.clear(); this.render(); } });
  },

  onContext(e) {
    e.preventDefault();
    const r = this.region(); if (!r) return;
    const noteEl = e.target.closest('.note');
    if (noteEl) {
      const n = r.notes.find(x => x.id === noteEl.dataset.id);
      if (n && !this.sel.has(n.id)) { this.sel.clear(); this.sel.add(n.id); this.render(); }
    }
    App.contextMenu(e, [
      { label: '削除', dis: !this.sel.size, fn: () => this.deleteSelected() },
      { label: '複製', dis: !this.sel.size, fn: () => this.duplicateSelected() },
      { sep: true },
      { label: 'クオンタイズ', dis: !this.sel.size, fn: () => this.quantize() },
      { label: 'レガート (次のノートまで伸ばす)', dis: !this.sel.size, fn: () => this.legato() },
      { label: 'ベロシティをランダム化', dis: !this.sel.size, fn: () => this.humanize() },
      { sep: true },
      { label: 'すべて選択', fn: () => { r.notes.forEach(n => this.sel.add(n.id)); this.render(); } }
    ]);
  },

  /* ── 編集コマンド ── */
  deleteSelected() {
    const r = this.region(); if (!r || !this.sel.size) return;
    Project.snapshot('ノート削除');
    r.notes = r.notes.filter(n => !this.sel.has(n.id));
    this.sel.clear(); this.render(); App.refreshArrangeOnly();
  },
  duplicateSelected() {
    const r = this.region(); if (!r || !this.sel.size) return;
    Project.snapshot('ノート複製');
    const sel = r.notes.filter(n => this.sel.has(n.id));
    let maxEnd = 0, minStart = 1e9;
    sel.forEach(n => { maxEnd = Math.max(maxEnd, n.start + n.length); minStart = Math.min(minStart, n.start); });
    const shift = Math.max(this.quant || 0.25, maxEnd - minStart);
    this.sel.clear();
    sel.forEach(n => { const c = Object.assign({}, n, { id: U.uid('n'), start: n.start + shift }); r.notes.push(c); this.sel.add(c.id); });
    this.render(); App.refreshArrangeOnly();
  },
  quantize() {
    const r = this.region(); if (!r) return;
    const q = this.quant; if (!q) { U.toast('クオンタイズがオフです'); return; }
    Project.snapshot('クオンタイズ');
    const target = this.sel.size ? r.notes.filter(n => this.sel.has(n.id)) : r.notes;
    target.forEach(n => n.start = Math.round(n.start / q) * q);
    this.render(); App.refreshArrangeOnly();
    U.toast(target.length + ' ノートをクオンタイズしました');
  },
  transpose(semi) {
    const r = this.region(); if (!r) return;
    Project.snapshot('トランスポーズ');
    const target = this.sel.size ? r.notes.filter(n => this.sel.has(n.id)) : r.notes;
    target.forEach(n => n.pitch = U.clamp(n.pitch + semi, 0, 127));
    this.render(); App.refreshArrangeOnly();
  },
  legato() {
    const r = this.region(); if (!r) return;
    Project.snapshot('レガート');
    const ns = r.notes.slice().sort((a, b) => a.start - b.start);
    for (let i = 0; i < ns.length; i++) {
      if (this.sel.size && !this.sel.has(ns[i].id)) continue;
      const nxt = ns.find(x => x.start > ns[i].start + 1e-6);
      if (nxt) ns[i].length = Math.max(0.0625, nxt.start - ns[i].start);
    }
    this.render();
  },
  humanize() {
    const r = this.region(); if (!r) return;
    Project.snapshot('ヒューマナイズ');
    const target = this.sel.size ? r.notes.filter(n => this.sel.has(n.id)) : r.notes;
    target.forEach(n => n.vel = U.clamp(Math.round(n.vel + (Math.random() - 0.5) * 26), 1, 127));
    this.render();
  },
  selectAll() { const r = this.region(); if (r) { r.notes.forEach(n => this.sel.add(n.id)); this.render(); } },

  updatePlayhead() {
    const r = this.region(); if (!r) return;
    const b = (Transport.isPlaying() ? Transport.now() : Transport.positionBeats) - r.start;
    const ph = U.$('#pr-playhead');
    const x = b * this.ppb;
    ph.style.left = x + 'px';
    ph.style.display = (x < -20 || x > r.length * this.ppb + 40) ? 'none' : 'block';
  }
};

window.PianoRoll = PianoRoll;
