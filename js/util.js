/* ══════════════════════════════════════════════════════════════
   util.js — 共通ユーティリティ
   ══════════════════════════════════════════════════════════════ */
'use strict';

const U = {
  clamp: (v, a, b) => v < a ? a : (v > b ? b : v),
  lerp:  (a, b, t) => a + (b - a) * t,
  uid:   (p) => (p || 'id') + '_' + Math.random().toString(36).slice(2, 9),
  round: (v, d) => { const m = Math.pow(10, d || 0); return Math.round(v * m) / m; },

  /* dB <-> gain */
  dbToGain: db => (db <= -60 ? 0 : Math.pow(10, db / 20)),
  gainToDb: g  => (g <= 0.001 ? -Infinity : 20 * Math.log10(g)),
  dbText: g => {
    const db = U.gainToDb(g);
    if (!isFinite(db)) return '-∞';
    return (db > 0 ? '+' : '') + db.toFixed(1);
  },
  /* フェーダーカーブ: 0..1 のスライダー位置 <-> ゲイン (0..~1.99, 0dB ≈ 0.775) */
  faderToGain: p => {
    if (p <= 0) return 0;
    const db = -60 + Math.pow(p, 0.6) * 72;   // -60dB .. +12dB
    return U.dbToGain(db);
  },
  gainToFader: g => {
    if (g <= 0) return 0;
    const db = U.clamp(U.gainToDb(g), -60, 12);
    return Math.pow((db + 60) / 72, 1 / 0.6);
  },

  /* MIDI */
  midiToFreq: n => 440 * Math.pow(2, (n - 69) / 12),
  NOTE_NAMES: ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'],
  noteName: n => U.NOTE_NAMES[((n % 12) + 12) % 12] + (Math.floor(n / 12) - 1),
  isBlackKey: n => [1,3,6,8,10].includes(((n % 12) + 12) % 12),

  /* 時間表記 */
  bbt(beats, sigNum) {
    sigNum = sigNum || 4;
    if (beats < 0) beats = 0;
    const bar  = Math.floor(beats / sigNum) + 1;
    const rem  = beats - (bar - 1) * sigNum;
    const beat = Math.floor(rem) + 1;
    const sub  = rem - Math.floor(rem);
    const div  = Math.floor(sub * 4) + 1;
    const tick = Math.floor((sub * 4 - Math.floor(sub * 4)) * 240);
    return bar + ' . ' + beat + ' . ' + div + ' . ' + String(tick).padStart(3, '0');
  },
  smpte(sec) {
    if (sec < 0) sec = 0;
    const h = Math.floor(sec / 3600),
          m = Math.floor(sec / 60) % 60,
          s = Math.floor(sec) % 60,
          ms = Math.floor((sec % 1) * 1000);
    const p = (n, l) => String(n).padStart(l, '0');
    return p(h, 2) + ':' + p(m, 2) + ':' + p(s, 2) + '.' + p(ms, 3);
  },

  /* DOM */
  el(tag, cls, txt) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (txt != null) e.textContent = txt;
    return e;
  },
  $:  s => document.querySelector(s),
  $$: s => Array.from(document.querySelectorAll(s)),

  /* ドラッグヘルパ: onMove(dx, dy, ev), onEnd(ev) */
  drag(startEv, onMove, onEnd, cursor) {
    startEv.preventDefault();
    const sx = startEv.clientX, sy = startEv.clientY;
    const prevCur = document.body.style.cursor;
    if (cursor) document.body.style.cursor = cursor;
    let moved = false;
    const mv = e => {
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
      onMove && onMove(dx, dy, e);
    };
    const up = e => {
      window.removeEventListener('mousemove', mv);
      window.removeEventListener('mouseup', up);
      document.body.style.cursor = prevCur;
      onEnd && onEnd(e, moved);
    };
    window.addEventListener('mousemove', mv);
    window.addEventListener('mouseup', up);
  },

  /* 縦ドラッグで値を変える汎用ノブ挙動 */
  dragValue(ev, cur, min, max, sensitivity, onChange, onDone) {
    const start = cur;
    const range = max - min;
    U.drag(ev, (dx, dy, e) => {
      const fine = e.shiftKey ? 0.2 : 1;
      let v = start - (dy / (sensitivity || 160)) * range * fine;
      v = U.clamp(v, min, max);
      onChange(v);
    }, onDone, 'ns-resize');
  },

  toast(msg, ms) {
    const w = U.$('#toast-wrap');
    const t = U.el('div', 'toast', msg);
    w.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .25s'; t.style.opacity = '0';
      setTimeout(() => t.remove(), 260);
    }, ms || 1900);
  },

  /* HiDPI canvas 準備 */
  fitCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (cv.__w !== w || cv.__h !== h || cv.__d !== dpr) {
      cv.width  = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      cv.style.width  = w + 'px';
      cv.style.height = h + 'px';
      cv.__w = w; cv.__h = h; cv.__d = dpr;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return ctx;
  },

  /* トラックカラーパレット (Logic 風) */
  COLORS: [
    '#6fb8e8', '#7fd6a8', '#e8c86a', '#e89a6a', '#e07a86', '#c48ae0',
    '#8a9ae0', '#6fd8d0', '#a8d86a', '#e8b0d0', '#d0a878', '#9ad0e8',
    '#f0a0a0', '#a0e0c0', '#d8d070', '#b0b0e8'
  ],
  shade(hex, amt) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    r = U.clamp(Math.round(r + amt), 0, 255);
    g = U.clamp(Math.round(g + amt), 0, 255);
    b = U.clamp(Math.round(b + amt), 0, 255);
    return '#' + ((r << 16) | (g << 8) | b).toString(16).padStart(6, '0');
  },

  download(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  },

  isMac: /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent),
  /* ⌘ (Mac) / Ctrl (Win) の統一判定 */
  cmd: e => (U.isMac ? e.metaKey : e.ctrlKey)
};
