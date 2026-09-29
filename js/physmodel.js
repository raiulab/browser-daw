/* ══════════════════════════════════════════════════════════════
   physmodel.js — 物理モデリング音源 (撥弦 / 打弦)

   Karplus-Strong 拡張モデルを純 JS で計算し、ノートごとに波形を
   生成してから再生する方式。
   Web Audio のノードで帰還ループを組むと最低 128 サンプルの遅延が
   入り高音のピッチが作れないため、DSP は JS 側で実行している。
   1 音あたりの生成は数ミリ秒で、生成後はキャッシュされる。

   ・弦の張力による非調和性 (オールパスによる分散) を再現
   ・ピッキング位置によるコムフィルタ
   ・ループ内ローパスによる高域から先に減衰する自然な音色変化
   ・複数弦のわずかなデチューン (ピアノのユニゾン弦・コーラス効果)
   ・胴鳴り (ボディ共鳴) を並列ピーキングフィルタで付加
   ══════════════════════════════════════════════════════════════ */
'use strict';

const PHYS_DEFAULTS = {
  model: 'steel',
  strings: 1,
  detune: 4,             /* 弦間のデチューン (セント) */
  decaySec: 3.2,         /* T60 の基準 */
  damping: 0.32,         /* ループ内ローパス係数 (0〜0.9) 大きいほど暗い */
  dampTrack: 0.35,       /* 高音ほど減衰を速める量 */
  excite: 'pluck',       /* pluck | strike */
  exciteDur: 0.005,
  exciteColor: 4200,
  pickPos: 0.24,
  inharmonic: 0.0,       /* 0〜0.6 弦の硬さ (非調和性) */
  brightness: 6000,      /* 出力ローパス基準 */
  velToBright: 0.75,
  attack: 0.001,
  release: 0.16,
  body: [[110, 2.5, 4], [230, 3.5, 2.5], [420, 3, -2], [2400, 1.5, 2]],
  bodyMix: 0.35,
  maxDur: 3.4,
  level: 0.6
};

/* ── 1 音ぶんの波形を生成 ── */
function renderPluckedString(sr, freq, P) {
  /* ワーカー内でも動くよう、外部依存を持たない */
  const cl = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const decay = Math.max(0.05, P.decaySec);
  /* 減衰時間から必要な長さを決める (高音は短くて済む) */
  const dur = cl(decay * 1.15, 0.25, P.maxDur);
  const len = Math.max(64, Math.floor(sr * dur));
  const out = new Float32Array(len);

  const nStr = cl(P.strings | 0, 1, 3);
  for (let sIdx = 0; sIdx < nStr; sIdx++) {
    const cents = nStr === 1 ? 0 : ((sIdx - (nStr - 1) / 2) * P.detune);
    const f = freq * Math.pow(2, cents / 1200);

    /* ループ長 (ローパスの群遅延ぶんを補正) */
    const Ltarget = sr / f - 0.5;
    if (Ltarget < 2) continue;
    const Lint = Math.floor(Ltarget);
    const frac = Ltarget - Lint;
    const size = Lint + 2;
    const buf = new Float32Array(size);

    /* 減衰 (周波数が高いほど自然に速く減衰する) */
    const t60 = decay * Math.pow(220 / Math.max(40, f), 0.35);
    let fb = Math.pow(10, -3 / (Math.max(20, f) * t60));
    fb = cl(fb, 0.5, 0.99995);

    /* ループ内ローパス係数 */
    const d = cl(P.damping + (f / 2000) * P.dampTrack, 0.02, 0.92);

    /* 励振信号 */
    const E = Math.max(2, Math.floor(sr * P.exciteDur));
    const exc = new Float32Array(E + 4);
    let lp = 0;
    const cf = Math.exp(-2 * Math.PI * P.exciteColor / sr);
    if (P.excite === 'strike') {
      /* ハンマー: レイズドコサインのパルス + わずかなノイズ */
      for (let i = 0; i < E; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / E);
        const n = (Math.random() * 2 - 1) * 0.25;
        lp = (1 - cf) * (w + n * w) + cf * lp;
        exc[i] = lp;
      }
    } else {
      /* ピッキング: フィルタしたノイズバースト */
      for (let i = 0; i < E; i++) {
        const w = Math.sin(Math.PI * i / E);
        const n = Math.random() * 2 - 1;
        lp = (1 - cf) * n + cf * lp;
        exc[i] = lp * w;
      }
    }
    /* ピッキング位置によるコムフィルタ */
    const pp = Math.round(cl(P.pickPos, 0.02, 0.5) * Lint);
    if (pp > 0 && pp < E) {
      for (let i = E - 1; i >= pp; i--) exc[i] -= exc[i - pp] * 0.85;
    }

    /* 非調和性 (1 次オールパスによる分散) */
    const a = cl(P.inharmonic, 0, 0.6);
    let apX = 0, apY = 0;

    let yLp = 0, wp = 0;
    const gain = 1 / nStr;
    const invFrac = 1 - frac;
    for (let i = 0; i < len; i++) {
      let r0 = wp - Lint; if (r0 < 0) r0 += size;
      let r1 = r0 - 1;    if (r1 < 0) r1 += size;
      let s = buf[r0] * invFrac + buf[r1] * frac;

      /* ループ内ローパス (1 極) */
      yLp = s * (1 - d) + yLp * d;
      let v = yLp * fb;

      /* オールパス (硬い弦の分散) */
      if (a > 0.001) {
        const y = -a * v + apX + a * apY;
        apX = v; apY = y;
        v = y;
      }

      const inp = i < E ? exc[i] : 0;
      buf[wp] = v + inp;
      out[i] += v * gain;
      wp = wp + 1 === size ? 0 : wp + 1;
    }
  }

  /* 正規化 + 末端フェード */
  let pk = 0;
  for (let i = 0; i < len; i++) { const x = Math.abs(out[i]); if (x > pk) pk = x; }
  if (pk > 1e-6) { const g = 0.92 / pk; for (let i = 0; i < len; i++) out[i] *= g; }
  const fade = Math.min(len, Math.floor(sr * 0.02));
  for (let i = 0; i < fade; i++) out[len - 1 - i] *= i / fade;
  return out;
}


/* ══════════════════════════════════════════════════════════════
   バックグラウンド生成ワーカー
     波形生成をワーカースレッドで行い、メインスレッド (= 発音と
     UI の応答性) を一切ブロックしない。
     Blob URL から生成するので file:// でも動作する。
   ══════════════════════════════════════════════════════════════ */
let _physWorker = null, _physSeq = 0;
const _physJobs = new Map();

function physWorker() {
  if (_physWorker !== null) return _physWorker;
  try {
    const src = renderPluckedString.toString() +
      '\nself.onmessage=function(e){' +
      'var d=renderPluckedString(e.data.sr,e.data.freq,e.data.P);' +
      'self.postMessage({id:e.data.id,pitch:e.data.pitch,data:d.buffer},[d.buffer]);};';
    const blob = new Blob([src], { type: 'text/javascript' });
    _physWorker = new Worker(URL.createObjectURL(blob));
    _physWorker.onmessage = ev => {
      const job = _physJobs.get(ev.data.id);
      _physJobs.delete(ev.data.id);
      if (job) job(new Float32Array(ev.data.data));
    };
    _physWorker.onerror = () => { _physWorker = false; };
  } catch (e) {
    _physWorker = false;      /* ワーカーが使えない環境ではメインスレッドで生成 */
  }
  return _physWorker;
}
function physRenderAsync(sr, freq, pitch, P, cb) {
  const w = physWorker();
  if (!w) {
    /* ワーカーが使えない環境 (古いブラウザ等) では、
       メインスレッドで生成しつつ必ず非同期にして UI を固めない */
    setTimeout(() => { try { cb(renderPluckedString(sr, freq, P)); } catch (e) { cb(new Float32Array(1)); } }, 0);
    return;
  }
  const id = ++_physSeq;
  _physJobs.set(id, cb);
  w.postMessage({ id, sr, freq, pitch, P });
}

/* ══════════════ 音源本体 ══════════════ */
function PhysModel(ctx, def, dest) {
  const P = deepMerge(PHYS_DEFAULTS, def.params);
  const self = { type: 'phys', params: P, def, engineName: 'PHYSICAL MODEL' };

  const out = ctx.createGain();
  out.gain.value = P.level;

  /* ボディ共鳴 (並列ピーキング) */
  const bodyIn = ctx.createGain();
  const dry = ctx.createGain(); dry.gain.value = 1 - P.bodyMix * 0.5;
  const wet = ctx.createGain(); wet.gain.value = P.bodyMix;
  bodyIn.connect(dry); dry.connect(out);
  (P.body || []).forEach(([f, q, g]) => {
    const b = ctx.createBiquadFilter();
    b.type = 'peaking'; b.frequency.value = f; b.Q.value = q; b.gain.value = g;
    bodyIn.connect(b); b.connect(wet);
  });
  wet.connect(out);
  out.connect(dest);

  const cache = new Map();          /* pitch -> AudioBuffer */
  const CACHE_MAX = 96;
  let disposed = false;
  const held = new Map();
  let bendCents = 0;

  function render(pitch) {
    const data = renderPluckedString(ctx.sampleRate, U.midiToFreq(pitch), P);
    const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
    b.getChannelData(0).set(data);
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(pitch, b);
    return b;
  }

  /* 発音時に未生成でも待たせない:
     近い音程の生成済み波形を再生レートで転用し、正確な波形は裏で作る。
     ±3 半音程度なら質感の差はほとんど分からない。 */
  function bufferFor(pitch) {
    const b = cache.get(pitch);
    if (b) return { buf: b, rate: 1 };
    for (let d = 1; d <= 3; d++) {
      const lo = cache.get(pitch - d), hi = cache.get(pitch + d);
      const near = lo || hi;
      if (near) {
        const from = lo ? pitch - d : pitch + d;
        queueRender(pitch);
        return { buf: near, rate: U.midiToFreq(pitch) / U.midiToFreq(from) };
      }
    }
    return { buf: render(pitch), rate: 1 };
  }

  /* ── バックグラウンド生成 (ワーカースレッド) ── */
  const queue = [];
  const pending = new Set();
  let inFlight = 0;
  const MAX_INFLIGHT = 2;

  function queueRender(pitch) {
    if (cache.has(pitch) || pending.has(pitch) || disposed) return;
    pending.add(pitch);
    queue.push(pitch);
    pump();
  }
  function pump() {
    while (inFlight < MAX_INFLIGHT && queue.length && !disposed) {
      const p2 = queue.shift();
      if (cache.has(p2)) { pending.delete(p2); continue; }
      inFlight++;
      physRenderAsync(ctx.sampleRate, U.midiToFreq(p2), p2, P, data => {
        inFlight--;
        pending.delete(p2);
        if (!disposed && !cache.has(p2)) {
          try {
            const b = ctx.createBuffer(1, data.length, ctx.sampleRate);
            b.getChannelData(0).set(data);
            if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
            cache.set(p2, b);
          } catch (e) {}
        }
        pump();
      });
    }
  }

  function makeVoice(pitch, time, vel) {
    const v = { pitch };
    const velN = Math.pow(U.clamp(vel, 1, 127) / 127, 1.1);
    const src = ctx.createBufferSource();
    const bs = bufferFor(pitch);
    src.buffer = bs.buf;
    src.playbackRate.value = bs.rate;
    if (bendCents && src.detune) src.detune.value = bendCents;

    /* 強く弾くほど明るく */
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = U.clamp(
      P.brightness * (0.28 + velN * P.velToBright * 1.5), 300, 18000);
    lpf.Q.value = 0.6;

    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(velN, time + Math.max(0.0005, P.attack));

    src.connect(lpf); lpf.connect(amp); amp.connect(bodyIn);
    src.start(time);
    v.src = src; v.amp = amp; v.lpf = lpf;
    v.endsAt = time + src.buffer.duration;
    src.onended = () => { try { amp.disconnect(); lpf.disconnect(); } catch (e) {} };
    return v;
  }

  function release(v, time) {
    if (v.released) return;
    v.released = true;
    const r = Math.max(0.02, P.release);
    try {
      v.amp.gain.cancelScheduledValues(time);
      v.amp.gain.setValueAtTime(Math.max(0.0001, v.amp.gain.value), time);
      v.amp.gain.setTargetAtTime(0.0001, time, r / 3.2);
    } catch (e) {}
    try { v.src.stop(time + r * 2 + 0.05); } catch (e) {}
  }

  self.noteOn = function (pitch, time, vel, dur) {
    time = Math.max(time, ctx.currentTime);
    const v = makeVoice(U.clamp(pitch, 12, 108), time, vel == null ? 100 : vel);
    if (dur != null) {
      /* 発音長より音の自然な減衰が短ければ、そのまま鳴らし切る */
      if (dur < v.src.buffer.duration - 0.05) release(v, time + Math.max(0.02, dur));
    } else {
      const arr = held.get(pitch) || []; arr.push(v); held.set(pitch, arr);
    }
    return v;
  };
  self.noteOff = function (pitch, time) {
    const arr = held.get(pitch); if (!arr || !arr.length) return;
    const v = arr.shift(); if (!arr.length) held.delete(pitch);
    release(v, Math.max(time || ctx.currentTime, ctx.currentTime));
  };
  self.allOff = function () {
    const t = ctx.currentTime;
    held.forEach(arr => arr.forEach(v => release(v, t)));
    held.clear();
  };
  self.dispose = function () {
    disposed = true;
    self.allOff();
    cache.clear();
    queue.length = 0; pending.clear();
    try { out.disconnect(); bodyIn.disconnect(); } catch (e) {}
  };
  self.setLevel = l => { out.gain.value = l; };
  self.setBend = function (semi) {
    bendCents = semi * 100;
    /* 発音中のボイスにも反映 */
    held.forEach(arr => arr.forEach(v => {
      if (v.src.detune) { try { v.src.detune.setTargetAtTime(bendCents, ctx.currentTime, 0.005); } catch (e) {} }
    }));
  };
  /* 演奏に使いそうな音域を、中央から外側へ向けて裏で生成しておく */
  self.prewarm = function (lo, hi) {
    const hasWorker = physWorker() !== false;
    /* ワーカーが無い環境では負荷を抑えるため範囲を絞る
       (足りない音程は近傍転用でカバーされる) */
    lo = lo == null ? (hasWorker ? 28 : 45) : lo;
    hi = hi == null ? (hasWorker ? 96 : 79) : hi;
    const center = Math.round((lo + hi) / 2);
    const order = [];
    for (let d = 0; d <= hi - lo; d++) {
      if (center - d >= lo) order.push(center - d);
      if (d && center + d <= hi) order.push(center + d);
    }
    order.forEach(queueRender);
  };
  /* 生成状況 (UI 表示用) */
  self.cacheInfo = () => ({ cached: cache.size, queued: queue.length + inFlight,
                            worker: _physWorker !== false });

  /* 中央の 1 音だけは即座に用意しておく (近傍転用の起点にする) */
  try { render(60); } catch (e) {}
  /* 残りはワーカーで裏から埋める */
  self.prewarm();
  return self;
}

/* ══════════════ プリセット ══════════════ */
const PHYS_PRESETS = {
  'Acoustic Guitar (Steel)': {
    model: 'steel', strings: 1, decaySec: 3.4, damping: 0.24, dampTrack: 0.40,
    excite: 'pluck', exciteDur: 0.0035, exciteColor: 6500, pickPos: 0.22,
    inharmonic: 0.06, brightness: 7200, velToBright: 0.8, release: 0.18,
    body: [[96, 2.2, 6], [196, 3.0, 3.5], [420, 2.6, -3], [2600, 1.4, 3], [3800, 1.8, 1.5]],
    bodyMix: 0.42, maxDur: 3.6, level: 0.55
  },
  'Acoustic Guitar (Nylon)': {
    model: 'nylon', strings: 1, decaySec: 2.6, damping: 0.40, dampTrack: 0.45,
    excite: 'pluck', exciteDur: 0.006, exciteColor: 3200, pickPos: 0.30,
    inharmonic: 0.02, brightness: 4200, velToBright: 0.7, release: 0.2,
    body: [[104, 2.0, 6.5], [210, 2.8, 3], [380, 2.4, -2], [1800, 1.4, 2]],
    bodyMix: 0.45, maxDur: 3.0, level: 0.58
  },
  'Grand Piano (Physical)': {
    model: 'piano', strings: 3, detune: 2.4, decaySec: 5.0, damping: 0.20, dampTrack: 0.55,
    excite: 'strike', exciteDur: 0.0026, exciteColor: 5200, pickPos: 0.12,
    inharmonic: 0.13, brightness: 6800, velToBright: 0.95, release: 0.09,
    body: [[70, 1.8, 4], [150, 2.2, 3], [500, 2.0, -2.5], [1400, 1.6, 2], [3200, 1.4, 1.5]],
    bodyMix: 0.30, maxDur: 3.8, level: 0.5
  },
  'Upright Piano': {
    model: 'piano', strings: 2, detune: 3.2, decaySec: 3.6, damping: 0.30, dampTrack: 0.55,
    excite: 'strike', exciteDur: 0.0032, exciteColor: 4200, pickPos: 0.15,
    inharmonic: 0.18, brightness: 5200, velToBright: 0.9, release: 0.10,
    body: [[84, 2.0, 5], [180, 2.4, 3], [560, 2.2, -3], [1600, 1.5, 2]],
    bodyMix: 0.34, maxDur: 3.6, level: 0.52
  },
  'Electric Bass (Finger)': {
    model: 'ebass', strings: 1, decaySec: 2.8, damping: 0.42, dampTrack: 0.30,
    excite: 'pluck', exciteDur: 0.007, exciteColor: 2600, pickPos: 0.18,
    inharmonic: 0.04, brightness: 3200, velToBright: 0.8, release: 0.12,
    body: [[62, 1.6, 4], [140, 2.0, 2], [700, 1.8, -3]],
    bodyMix: 0.18, maxDur: 3.0, level: 0.62
  },
  'Upright Bass': {
    model: 'upright', strings: 1, decaySec: 2.0, damping: 0.55, dampTrack: 0.30,
    excite: 'pluck', exciteDur: 0.012, exciteColor: 1600, pickPos: 0.34,
    inharmonic: 0.02, brightness: 2200, velToBright: 0.7, release: 0.22,
    body: [[52, 1.4, 7], [110, 1.8, 4], [280, 2.0, -2], [900, 1.4, 1.5]],
    bodyMix: 0.5, maxDur: 2.6, level: 0.62
  },
  'Harp': {
    model: 'harp', strings: 1, decaySec: 4.2, damping: 0.22, dampTrack: 0.5,
    excite: 'pluck', exciteDur: 0.004, exciteColor: 5200, pickPos: 0.4,
    inharmonic: 0.01, brightness: 6800, velToBright: 0.7, release: 0.3,
    body: [[130, 2.0, 5], [260, 2.6, 3], [1200, 1.6, 2]],
    bodyMix: 0.4, maxDur: 3.6, level: 0.5
  },
  'Clean Electric Guitar': {
    model: 'steel', strings: 1, decaySec: 3.0, damping: 0.30, dampTrack: 0.35,
    excite: 'pluck', exciteDur: 0.003, exciteColor: 7200, pickPos: 0.14,
    inharmonic: 0.05, brightness: 5200, velToBright: 0.85, release: 0.15,
    body: [[180, 1.6, 2], [900, 1.4, -2], [2400, 1.6, 3]],
    bodyMix: 0.12, maxDur: 3.2, level: 0.55
  }
};

window.PhysModel = PhysModel;
window.PHYS_DEFAULTS = PHYS_DEFAULTS;
window.PHYS_PRESETS = PHYS_PRESETS;
window.renderPluckedString = renderPluckedString;
window.physRenderAsync = physRenderAsync;
