/* ══════════════════════════════════════════════════════════════
   audio.js — オーディオファイルの読み込み / アセット管理 / 波形解析 / 破壊編集

   対応: WAV (8/16/24/32bit PCM・32bit float) 8k〜96kHz、
         AIFF / MP3 / M4A / OGG / FLAC (ブラウザのデコーダ経由)
   WAV は元のサンプルレートを保ったままデコードするため、
   96kHz ファイルは 96kHz のまま保持される。
   ══════════════════════════════════════════════════════════════ */
'use strict';

const PEAK_BUCKET = 256;      /* 波形ピークの解像度 (サンプル/バケット) */

/* ── WAV ヘッダ解析 (元のスペック表示用) ── */
function parseWavHeader(arrayBuffer) {
  try {
    const dv = new DataView(arrayBuffer);
    if (dv.getUint32(0, false) !== 0x52494646) return null;       /* 'RIFF' */
    if (dv.getUint32(8, false) !== 0x57415645) return null;       /* 'WAVE' */
    let off = 12;
    while (off + 8 <= dv.byteLength) {
      const id = dv.getUint32(off, false);
      const size = dv.getUint32(off + 4, true);
      if (id === 0x666d7420) {                                     /* 'fmt ' */
        const format = dv.getUint16(off + 8, true);
        const channels = dv.getUint16(off + 10, true);
        const rate = dv.getUint32(off + 12, true);
        const bits = dv.getUint16(off + 22, true);
        return { format, channels, sampleRate: rate, bitDepth: bits,
                 float: format === 3 || (format === 0xFFFE && bits === 32) };
      }
      off += 8 + size + (size & 1);
    }
  } catch (e) {}
  return null;
}

const AudioPool = {
  assets: {},                 /* id -> {id,name,buffer,peaks,meta} */

  add(name, buffer, meta) {
    const id = U.uid('aud');
    const a = { id, name, buffer, meta: meta || {}, peaks: null };
    a.peaks = this.computePeaks(buffer);
    this.assets[id] = a;
    return a;
  },
  get(id) { return this.assets[id]; },
  buffer(id) { const a = this.assets[id]; return a && a.buffer; },
  replace(id, buffer) {
    const a = this.assets[id];
    if (!a) return;
    a.buffer = buffer;
    a.peaks = this.computePeaks(buffer);
  },
  remove(id) { delete this.assets[id]; },
  clear() { this.assets = {}; },

  gc() {
    const used = new Set();
    (Project.data.tracks || []).forEach(t => t.regions.forEach(r => { if (r.audioId) used.add(r.audioId); }));
    Object.keys(this.assets).forEach(id => { if (!used.has(id)) delete this.assets[id]; });
  },

  /* ── ピーク (min/max) を事前計算して波形描画を高速化 ── */
  computePeaks(buffer) {
    const chs = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const d = buffer.getChannelData(c);
      const n = Math.ceil(d.length / PEAK_BUCKET);
      const mn = new Float32Array(n), mx = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const s = i * PEAK_BUCKET, e = Math.min(d.length, s + PEAK_BUCKET);
        let lo = 1, hi = -1;
        for (let j = s; j < e; j++) { const v = d[j]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (s >= e) { lo = 0; hi = 0; }
        mn[i] = lo; mx[i] = hi;
      }
      chs.push({ min: mn, max: mx });
    }
    return { bucket: PEAK_BUCKET, channels: chs, length: buffer.length };
  },

  /* ── ファイル読み込み ── */
  async importFile(file) {
    const ab = await file.arrayBuffer();
    const wav = parseWavHeader(ab);
    let buffer;

    if (wav && wav.sampleRate >= 8000 && wav.sampleRate <= 96000) {
      /* WAV は元のサンプルレートを保ったままデコードする */
      const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      const tmp = new OAC(Math.max(1, Math.min(32, wav.channels || 2)), 1, wav.sampleRate);
      buffer = await tmp.decodeAudioData(ab.slice(0));
    } else {
      buffer = await Engine.ctx.decodeAudioData(ab.slice(0));
    }

    const meta = {
      fileName: file.name,
      fileSize: file.size,
      origRate: wav ? wav.sampleRate : buffer.sampleRate,
      origBits: wav ? (wav.float ? '32f' : wav.bitDepth) : '—',
      origCh: wav ? wav.channels : buffer.numberOfChannels,
      format: wav ? 'WAV' : (file.name.split('.').pop() || '').toUpperCase()
    };
    const name = file.name.replace(/\.[^.]+$/, '');
    return this.add(name, buffer, meta);
  },

  /* ── プロジェクト保存用: WAV + Base64 ── */
  async serializeAsync(bits) {
    const out = {};
    for (const a of Object.values(this.assets)) {
      const blob = encodeWav(a.buffer, bits || 24);
      out[a.id] = { name: a.name, meta: a.meta, rate: a.buffer.sampleRate,
                    wav: await blobToBase64(blob) };
    }
    return out;
  },
  async deserialize(data) {
    this.clear();
    if (!data) return;
    for (const id of Object.keys(data)) {
      const rec = data[id];
      try {
        const ab = base64ToArrayBuffer(rec.wav);
        const wav = parseWavHeader(ab);
        const rate = (wav && wav.sampleRate) || rec.rate || 48000;
        const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const tmp = new OAC(Math.max(1, (wav && wav.channels) || 2), 1, rate);
        const buffer = await tmp.decodeAudioData(ab);
        this.assets[id] = { id, name: rec.name, buffer, meta: rec.meta || {},
                            peaks: this.computePeaks(buffer) };
      } catch (e) { /* 壊れたアセットは無視 */ }
    }
  },

  totalBytes() {
    let n = 0;
    Object.values(this.assets).forEach(a => { n += a.buffer.length * a.buffer.numberOfChannels * 4; });
    return n;
  }
};

/* ── Base64 変換 ── */
function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}
function base64ToArrayBuffer(b64) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/* ══════════════════ AudioBuffer 加工ユーティリティ ══════════════════ */
const AudioFX = {
  clone(buf, ctx) {
    const c = ctx || Engine.ctx;
    const out = c.createBuffer(buf.numberOfChannels, buf.length, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) out.getChannelData(ch).set(buf.getChannelData(ch));
    return out;
  },
  process(buf, s, e, fn) {
    const out = this.clone(buf);
    for (let ch = 0; ch < out.numberOfChannels; ch++) fn(out.getChannelData(ch), s, e, ch);
    return out;
  },
  peakOf(buf, s, e) {
    let pk = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = s; i < e; i++) { const a = Math.abs(d[i]); if (a > pk) pk = a; }
    }
    return pk;
  },
  rmsOf(buf, s, e) {
    let sum = 0, n = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = s; i < e; i++) { sum += d[i] * d[i]; n++; }
    }
    return n ? Math.sqrt(sum / n) : 0;
  },

  gain(buf, s, e, mul) { return this.process(buf, s, e, (d, a, b) => { for (let i = a; i < b; i++) d[i] *= mul; }); },
  normalize(buf, s, e, targetDb) {
    const pk = this.peakOf(buf, s, e);
    if (pk <= 0) return buf;
    const target = Math.pow(10, (targetDb == null ? -0.3 : targetDb) / 20);
    return this.gain(buf, s, e, target / pk);
  },
  fadeIn(buf, s, e, curve) {
    const n = Math.max(1, e - s);
    return this.process(buf, s, e, (d, a, b) => {
      for (let i = a; i < b; i++) {
        const t = (i - a) / n;
        d[i] *= curve === 'log' ? t * t : (curve === 'exp' ? Math.sqrt(t) : t);
      }
    });
  },
  fadeOut(buf, s, e, curve) {
    const n = Math.max(1, e - s);
    return this.process(buf, s, e, (d, a, b) => {
      for (let i = a; i < b; i++) {
        const t = 1 - (i - a) / n;
        d[i] *= curve === 'log' ? t * t : (curve === 'exp' ? Math.sqrt(t) : t);
      }
    });
  },
  silence(buf, s, e) { return this.process(buf, s, e, (d, a, b) => { for (let i = a; i < b; i++) d[i] = 0; }); },
  invert(buf, s, e) { return this.process(buf, s, e, (d, a, b) => { for (let i = a; i < b; i++) d[i] = -d[i]; }); },
  removeDC(buf, s, e) {
    return this.process(buf, s, e, (d, a, b) => {
      let sum = 0; for (let i = a; i < b; i++) sum += d[i];
      const m = sum / Math.max(1, b - a);
      for (let i = a; i < b; i++) d[i] -= m;
    });
  },
  reverse(buf, s, e) {
    return this.process(buf, s, e, (d, a, b) => {
      for (let i = 0, n = Math.floor((b - a) / 2); i < n; i++) {
        const t = d[a + i]; d[a + i] = d[b - 1 - i]; d[b - 1 - i] = t;
      }
    });
  },
  crop(buf, s, e) {
    const n = Math.max(1, e - s);
    const out = Engine.ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      out.getChannelData(ch).set(buf.getChannelData(ch).subarray(s, e));
    }
    return out;
  },
  cut(buf, s, e) {
    const n = buf.length - (e - s);
    if (n <= 0) return buf;
    const out = Engine.ctx.createBuffer(buf.numberOfChannels, n, buf.sampleRate);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const src = buf.getChannelData(ch), dst = out.getChannelData(ch);
      dst.set(src.subarray(0, s), 0);
      dst.set(src.subarray(e), s);
    }
    return out;
  },
  insert(buf, at, ins) {
    const ch = Math.max(buf.numberOfChannels, ins.numberOfChannels);
    const out = Engine.ctx.createBuffer(ch, buf.length + ins.length, buf.sampleRate);
    for (let c = 0; c < ch; c++) {
      const s1 = buf.getChannelData(Math.min(c, buf.numberOfChannels - 1));
      const s2 = ins.getChannelData(Math.min(c, ins.numberOfChannels - 1));
      const d = out.getChannelData(c);
      d.set(s1.subarray(0, at), 0);
      d.set(s2, at);
      d.set(s1.subarray(at), at + ins.length);
    }
    return out;
  },
  insertSilence(buf, at, frames) {
    const out = Engine.ctx.createBuffer(buf.numberOfChannels, buf.length + frames, buf.sampleRate);
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const s = buf.getChannelData(c), d = out.getChannelData(c);
      d.set(s.subarray(0, at), 0);
      d.set(s.subarray(at), at + frames);
    }
    return out;
  },


  /* ══════════════════════════════════════════════════════════════
     タイムストレッチ (SOLA: Synchronized Overlap-Add)
       ピッチを保ったまま長さだけを変える。完全オフライン処理なので
       再生を妨げず、リアルタイム負荷も増えない。
       ratio = 出力長 / 入力長  (1.5 なら 1.5 倍の長さ=ゆっくり)
       実用範囲は 0.5〜2.0 倍。それを超えると音質が落ちる。
     ══════════════════════════════════════════════════════════════ */
  timeStretch(buf, ratio, onProgress) {
    ratio = U.clamp(ratio, 0.25, 4);
    if (Math.abs(ratio - 1) < 0.0005) return buf;

    const sr = buf.sampleRate;
    const nCh = buf.numberOfChannels;
    const N = Math.max(512, Math.round(sr * 0.043));     /* フレーム長 ≒ 43ms */
    const Sa = Math.round(N / 4);                         /* 解析ホップ */
    const Ss = Math.max(1, Math.round(Sa * ratio));       /* 合成ホップ */
    const OV = Math.min(Sa, Math.round(N / 4));           /* クロスフェード長 */
    const SEEK = Math.round(N / 8);                       /* 相関探索範囲 */
    const inLen = buf.length;
    const outLen = Math.max(1, Math.ceil(inLen * ratio) + N);

    /* 位置合わせはモノラルミックスで行い、全チャンネルに同じずれを適用する
       (これでステレオの位相関係が崩れない) */
    const guide = new Float32Array(inLen);
    for (let c = 0; c < nCh; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < inLen; i++) guide[i] += d[i] / nCh;
    }

    const src = [];
    for (let c = 0; c < nCh; c++) src.push(buf.getChannelData(c));
    const out = [];
    for (let c = 0; c < nCh; c++) out.push(new Float32Array(outLen));

    /* 最初のフレームはそのままコピー */
    const first = Math.min(N, inLen);
    for (let c = 0; c < nCh; c++) out[c].set(src[c].subarray(0, first), 0);

    let outPos = Ss;
    let m = 1;
    const STEP = 2;                                       /* 相関計算の間引き */
    let written = first;

    while (true) {
      const anaIdeal = m * Sa;
      if (anaIdeal + N >= inLen) break;
      if (outPos + N >= outLen) break;

      /* out の末尾 OV サンプルと最も一致する入力位置を探す */
      let best = 0, bestScore = -Infinity;
      const lo = Math.max(0, anaIdeal - SEEK);
      const hi = Math.min(inLen - N - 1, anaIdeal + SEEK);
      for (let k = lo; k <= hi; k++) {
        let num = 0, den = 1e-9;
        for (let i = 0; i < OV; i += STEP) {
          const a = out[0][outPos + i];
          const b = guide[k + i];
          num += a * b; den += b * b;
        }
        const score = num / Math.sqrt(den);
        if (score > bestScore) { bestScore = score; best = k; }
      }

      /* クロスフェードして重ね合わせ */
      for (let c = 0; c < nCh; c++) {
        const o = out[c], s2 = src[c];
        for (let i = 0; i < OV; i++) {
          const f = i / OV;
          o[outPos + i] = o[outPos + i] * (1 - f) + s2[best + i] * f;
        }
        for (let i = OV; i < N; i++) o[outPos + i] = s2[best + i];
      }
      written = outPos + N;
      outPos += Ss;
      m++;
      if (onProgress && (m % 64 === 0)) onProgress(anaIdeal / inLen);
    }

    const finalLen = Math.max(1, Math.min(outLen, Math.max(written, Math.round(inLen * ratio))));
    const res = Engine.ctx.createBuffer(nCh, finalLen, sr);
    for (let c = 0; c < nCh; c++) res.getChannelData(c).set(out[c].subarray(0, finalLen));
    return res;
  },

  /* ── サンプルレート変換 / ピッチ・速度変更 ── */
  async resample(buf, targetRate) {
    if (Math.abs(buf.sampleRate - targetRate) < 1) return buf;
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const frames = Math.max(1, Math.ceil(buf.length * targetRate / buf.sampleRate));
    const ctx = new OAC(buf.numberOfChannels, frames, targetRate);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination); src.start(0);
    return await ctx.startRendering();
  },
  async varispeed(buf, rate) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const frames = Math.max(1, Math.ceil(buf.length / rate));
    const ctx = new OAC(buf.numberOfChannels, frames, buf.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.playbackRate.value = rate;
    src.connect(ctx.destination); src.start(0);
    return await ctx.startRendering();
  },
  async pitchShift(buf, semitones) { return this.varispeed(buf, Math.pow(2, semitones / 12)); },

  /* 長さを保ったままピッチだけ変える (バリスピード → タイムストレッチで補正) */
  async pitchShiftKeepLength(buf, semitones) {
    const r = Math.pow(2, semitones / 12);
    const sped = await this.varispeed(buf, r);          /* 長さが 1/r になる */
    return this.timeStretch(sped, r);                   /* 元の長さへ戻す */
  },
  async applyEffect(buf, build) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    const ctx = new OAC(buf.numberOfChannels, buf.length, buf.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const node = build(ctx, src);
    (node || src).connect(ctx.destination);
    src.start(0);
    return await ctx.startRendering();
  }
};

window.AudioPool = AudioPool;
window.AudioFX = AudioFX;
window.parseWavHeader = parseWavHeader;
window.blobToBase64 = blobToBase64;
window.base64ToArrayBuffer = base64ToArrayBuffer;

/* ══════════════════════════════════════════════════════════════
   オーディオリージョンのスケジューリング (ライブ / オフライン共通)

     beat → 時刻の対応: time = t0 + (beat - refBeat) * spb
     fromBeat から toBeat までを再生する。途中から再生する場合は
     バッファ内オフセットを計算して途切れなく続ける。
   ══════════════════════════════════════════════════════════════ */
function scheduleAudioRegion(ctx, dest, r, buf, regionStart, t0, refBeat, spb, fromBeat, toBeat) {
  if (!buf || toBeat <= fromBeat) return null;
  const rate = r.rate || 1;
  const when = t0 + (fromBeat - refBeat) * spb;
  const into = (fromBeat - regionStart) * spb;                 /* リージョン頭からの経過秒 */
  const offset = Math.max(0, (r.offset || 0) + into * rate);
  if (offset >= buf.duration) return null;
  const wallDur = (toBeat - fromBeat) * spb;
  const bufDur = Math.min(wallDur * rate, buf.duration - offset);
  if (bufDur <= 0.0005) return null;

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = rate;
  if (r.detune && src.detune) src.detune.value = r.detune;

  const g = ctx.createGain();
  const base = (r.gain == null ? 1 : r.gain);
  g.gain.setValueAtTime(base, when);

  /* フェードイン / フェードアウト (拍単位) */
  const fi = (r.fadeIn || 0) * spb, fo = (r.fadeOut || 0) * spb;
  const regStartT = t0 + (regionStart - refBeat) * spb;
  const regEndT = t0 + (regionStart + r.length - refBeat) * spb;
  if (fi > 0.001 && when < regStartT + fi) {
    const startG = base * U.clamp((when - regStartT) / fi, 0, 1);
    g.gain.setValueAtTime(startG, when);
    g.gain.linearRampToValueAtTime(base, regStartT + fi);
  }
  if (fo > 0.001) {
    g.gain.setValueAtTime(base, Math.max(when, regEndT - fo));
    g.gain.linearRampToValueAtTime(0.0001, regEndT);
  }

  /* パン (リージョン単位) */
  let tail = g;
  if (r.pan && ctx.createStereoPanner) {
    const p = ctx.createStereoPanner();
    p.pan.value = U.clamp(r.pan, -1, 1);
    g.connect(p); tail = p;
  }
  src.connect(g);
  tail.connect(dest);

  src.start(Math.max(when, ctx.currentTime), offset, bufDur);
  const stopAt = when + wallDur + 0.02;
  try { src.stop(stopAt); } catch (e) {}
  return { src, gain: g, stopAt };
}

window.scheduleAudioRegion = scheduleAudioRegion;
