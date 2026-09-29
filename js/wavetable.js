/* ══════════════════════════════════════════════════════════════
   wavetable.js — ウェーブテーブル生成 (Serum 方式のフレーム補間用)

   各ウェーブテーブルは「フレーム」の配列。1 フレーム = 倍音振幅の配列で、
   AudioContext.createPeriodicWave() に渡して帯域制限された波形にする。
   MORPH ノブは隣接する 2 フレームをクロスフェードして連続変形させる。
   ══════════════════════════════════════════════════════════════ */
'use strict';

const WT_HARMONICS = 128;          /* 倍音数 (1..127) */

/* 倍音振幅配列を作るヘルパ */
function wtMake(fn) {
  const im = new Float32Array(WT_HARMONICS);
  for (let k = 1; k < WT_HARMONICS; k++) {
    const v = fn(k);
    im[k] = (isFinite(v) ? v : 0);
  }
  return im;
}
function wtLerp(a, b, t) {
  const out = new Float32Array(WT_HARMONICS);
  for (let k = 0; k < WT_HARMONICS; k++) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}
/* 決定論的な擬似乱数 (テーブルを毎回同じにするため) */
function wtRand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/* ── 基本波形 ── */
const WT_SINE   = wtMake(k => k === 1 ? 1 : 0);
const WT_TRI    = wtMake(k => k % 2 ? (8 / (Math.PI * Math.PI)) * (((k - 1) / 2) % 2 ? -1 : 1) / (k * k) : 0);
const WT_SAW    = wtMake(k => 2 / (Math.PI * k) * (k % 2 ? 1 : -1));
const WT_SQUARE = wtMake(k => k % 2 ? 4 / (Math.PI * k) : 0);
const wtPulse = d => wtMake(k => (2 / (Math.PI * k)) * Math.sin(Math.PI * k * d));

/* ════════ ウェーブテーブル定義 ════════ */
const WAVETABLES = {

  /* 1. サイン→三角→ノコギリ→矩形→パルス へ連続変形 */
  'Basic Shapes': (() => {
    const key = [WT_SINE, WT_TRI, WT_SAW, WT_SQUARE, wtPulse(0.25), wtPulse(0.1)];
    const out = [];
    const frames = 16;
    for (let i = 0; i < frames; i++) {
      const p = i / (frames - 1) * (key.length - 1);
      const a = Math.floor(p), b = Math.min(key.length - 1, a + 1);
      out.push(wtLerp(key[a], key[b], p - a));
    }
    return out;
  })(),

  /* 2. アナログノコギリ: 倍音のロールオフが変化 */
  'Analog Saw': (() => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const roll = 1 + i * 0.16;
      out.push(wtMake(k => (2 / (Math.PI * Math.pow(k, roll))) * (k % 2 ? 1 : -1)));
    }
    return out;
  })(),

  /* 3. ハーモニクス: 倍音を順に積み上げる (オルガン〜ベル) */
  'Harmonic Stack': (() => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const n = 1 + i * 1.9;
      out.push(wtMake(k => k <= n ? Math.pow(0.72, k - 1) + (k === Math.round(n) ? 0.4 : 0) : 0));
    }
    return out;
  })(),

  /* 4. ボーカル フォルマント (A→E→I→O→U) */
  'Vowel Formant': (() => {
    /* 各母音のフォルマント (倍音番号, ゲイン) を近似 */
    const vowels = [
      [[7, 1], [12, .8], [25, .35]],     // A
      [[5, 1], [20, .7], [30, .3]],      // E
      [[3, 1], [26, .8], [34, .35]],     // I
      [[5, 1], [9, .6], [22, .2]],       // O
      [[3, 1], [7, .5], [18, .18]]       // U
    ];
    const frameOf = v => wtMake(k => {
      let g = 0.13 / k;
      v.forEach(([c, a]) => { g += a * Math.exp(-Math.pow((k - c) / (c * 0.28 + 1.6), 2)); });
      return g;
    });
    const key = vowels.map(frameOf);
    const out = [];
    for (let i = 0; i < 16; i++) {
      const p = i / 15 * (key.length - 1);
      const a = Math.floor(p), b = Math.min(key.length - 1, a + 1);
      out.push(wtLerp(key[a], key[b], p - a));
    }
    return out;
  })(),

  /* 5. ハードシンク風 (倍音コムが上へ移動) */
  'Sync Sweep': (() => {
    const out = [];
    for (let i = 0; i < 16; i++) {
      const ratio = 1 + i * 0.55;
      out.push(wtMake(k => {
        const w = Math.abs(Math.sin(Math.PI * k / (ratio * 3 + 1)));
        return (2 / (Math.PI * k)) * (0.25 + w) * (k % 2 ? 1 : -1);
      }));
    }
    return out;
  })(),

  /* 6. ベル / メタリック (非整数比に近い疎な倍音) */
  'Bell Metal': (() => {
    const sets = [
      [1, 2.8, 5.4, 8.9], [1, 3, 6, 10.2], [1, 2.4, 4.7, 7.1, 11],
      [1, 3.6, 7.2, 12.4], [1, 2, 5, 9, 14], [1, 4.2, 8.4, 13.6]
    ];
    return sets.map(set => wtMake(k => {
      let g = 0;
      set.forEach((h, i) => {
        const c = h * 3;
        g += Math.pow(0.62, i) * Math.exp(-Math.pow((k - c) / 1.3, 2));
      });
      return g;
    }));
  })(),

  /* 7. デジタル / パルス幅変調 */
  'Digital PWM': (() => {
    const out = [];
    for (let i = 0; i < 16; i++) out.push(wtPulse(0.5 - i * 0.028));
    return out;
  })(),

  /* 8. グロウル (ダブステップ系のうねり) */
  'Growl': (() => {
    const out = [];
    for (let i = 0; i < 14; i++) {
      const f1 = 4 + i * 2.4, f2 = 11 + i * 4.1;
      out.push(wtMake(k => {
        const base = (2 / (Math.PI * k)) * (k % 2 ? 1 : -1);
        const bump = 1 + 2.6 * Math.exp(-Math.pow((k - f1) / 2.4, 2))
                       + 1.9 * Math.exp(-Math.pow((k - f2) / 4.2, 2));
        return base * bump;
      }));
    }
    return out;
  })(),

  /* 9. ダスト (擬似ランダム倍音 — ノイジーで金属的) */
  'Dust': (() => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const rnd = wtRand(1234 + i * 77);
      const amps = new Float32Array(WT_HARMONICS);
      for (let k = 1; k < WT_HARMONICS; k++) amps[k] = (rnd() * 2 - 1) / Math.pow(k, 0.72);
      out.push(amps);
    }
    return out;
  })(),

  /* 10. ソフトパッド (低次倍音中心のなめらかな変化) */
  'Soft Pad': (() => {
    const out = [];
    for (let i = 0; i < 12; i++) {
      const tilt = 2.4 - i * 0.13;
      out.push(wtMake(k => k <= 24 ? Math.pow(k, -tilt) * (1 + 0.4 * Math.sin(k * 1.7 + i)) : 0));
    }
    return out;
  })()
};

/* ── PeriodicWave のキャッシュ (コンテキストごと) ── */
const _pwCache = new WeakMap();
function wtPeriodicWave(ctx, tableName, frameIdx) {
  let byCtx = _pwCache.get(ctx);
  if (!byCtx) { byCtx = new Map(); _pwCache.set(ctx, byCtx); }
  const key = tableName + '#' + frameIdx;
  let pw = byCtx.get(key);
  if (pw) return pw;
  const tbl = WAVETABLES[tableName] || WAVETABLES['Basic Shapes'];
  const f = tbl[U.clamp(frameIdx, 0, tbl.length - 1)];
  const real = new Float32Array(WT_HARMONICS);
  pw = ctx.createPeriodicWave(real, f, { disableNormalization: false });
  byCtx.set(key, pw);
  return pw;
}

/* ── 表示用: フレームを時間波形に変換 (キャンバス描画用) ── */
function wtRenderFrame(tableName, frameIdx, points) {
  const tbl = WAVETABLES[tableName] || WAVETABLES['Basic Shapes'];
  const f = tbl[U.clamp(Math.round(frameIdx), 0, tbl.length - 1)];
  const n = points || 256;
  const out = new Float32Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    let v = 0;
    for (let k = 1; k < 48; k++) { const a = f[k]; if (a) v += a * Math.sin(k * t); }
    out[i] = v;
    if (Math.abs(v) > peak) peak = Math.abs(v);
  }
  if (peak > 0) for (let i = 0; i < n; i++) out[i] /= peak;
  return out;
}
function wtFrameCount(tableName) {
  const tbl = WAVETABLES[tableName] || WAVETABLES['Basic Shapes'];
  return tbl.length;
}

window.WAVETABLES = WAVETABLES;
window.wtPeriodicWave = wtPeriodicWave;
window.wtRenderFrame = wtRenderFrame;
window.wtFrameCount = wtFrameCount;
