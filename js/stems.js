/* ══════════════════════════════════════════════════════════════
   stems.js — ステム分割 (DSP ベース / ワーカースレッド実行)

   ※ これは Demucs / Spleeter のような AI (深層学習) 分離ではありません。
     学習済みモデルは数百 MB あり、オフライン単体で動く本ソフトには
     同梱できないためです。代わりに古典的信号処理を組み合わせます。

     ① HPSS (Harmonic / Percussive Source Separation)
        スペクトログラムを時間方向に平滑化 = ハーモニック、
        周波数方向に平滑化 = パーカッシブ とみなし軟マスクを作る。
     ② M/S 分離 … センター定位 (ボーカル等) とサイドを分ける
     ③ 帯域分割 … ベースとそれ以外を周波数で分ける

     分離は完全ではなくステム間にかぶりが残りますが、リミックス素材や
     パート確認・練習用途には十分実用的です。
     計算はすべて Web Worker で行うため、UI と再生は止まりません。
   ══════════════════════════════════════════════════════════════ */
'use strict';

/* ══════════ 以下 4 つはワーカーへ文字列として渡すため、
              外部変数に一切依存しないように書く ══════════ */

function stemsFFT(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (inverse ? 2 : -2) * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ur = re[i + k], ui = im[i + k];
        const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k] = ur + vr; im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

function stemsMovAvg(src, dst, n, radius) {
  let sum = 0, cnt = Math.min(n, radius + 1);
  for (let i = 0; i < cnt; i++) sum += src[i];
  for (let i = 0; i < n; i++) {
    dst[i] = sum / cnt;
    const add = i + radius + 1, rem = i - radius;
    if (add < n) { sum += src[add]; cnt++; }
    if (rem >= 0) { sum -= src[rem]; cnt--; }
  }
}

/* ステム分割の本体 (ワーカー内でも main でも動く) */
function stemsCore(L, R, sr, N, H, report) {
  const len = L.length;
  const bins = N / 2 + 1;
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N);

  const mid = new Float32Array(len), side = new Float32Array(len);
  for (let i = 0; i < len; i++) { mid[i] = (L[i] + R[i]) * 0.5; side[i] = (L[i] - R[i]) * 0.5; }

  function stft(data) {
    const frames = Math.max(1, Math.floor((data.length - N) / H) + 1);
    const pr = new Float32Array(frames * bins), pi = new Float32Array(frames * bins);
    const mg = new Float32Array(frames * bins);
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      const off = f * H;
      for (let i = 0; i < N; i++) { re[i] = (data[off + i] || 0) * win[i]; im[i] = 0; }
      stemsFFT(re, im, false);
      for (let k = 0; k < bins; k++) {
        const a = re[k], b = im[k];
        pr[f * bins + k] = a; pi[f * bins + k] = b;
        mg[f * bins + k] = Math.sqrt(a * a + b * b);
      }
    }
    return { frames, pr, pi, mg };
  }

  function istft(S, mask, binGain) {
    const frames = S.frames;
    const out = new Float32Array(len), norm = new Float32Array(len);
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < bins; k++) {
        const g = binGain ? mask[f * bins + k] * binGain[k] : mask[f * bins + k];
        re[k] = S.pr[f * bins + k] * g;
        im[k] = S.pi[f * bins + k] * g;
        if (k > 0 && k < N / 2) { re[N - k] = re[k]; im[N - k] = -im[k]; }
      }
      im[0] = 0; im[N / 2] = 0;
      stemsFFT(re, im, true);
      const off = f * H;
      for (let i = 0; i < N; i++) {
        const p = off + i;
        if (p >= len) break;
        out[p] += re[i] * win[i];
        norm[p] += win[i] * win[i];
      }
    }
    /* 端は重なりが少なく norm が極小になるので下限を設けて発散を防ぐ */
    const NMIN = 0.15;
    for (let i = 0; i < len; i++) {
      const nz = norm[i];
      out[i] = nz > NMIN ? out[i] / nz : (nz > 1e-6 ? out[i] / NMIN : 0);
    }
    return out;
  }

  function hpss(S, tRad, fRad) {
    const frames = S.frames, mg = S.mg;
    const Hh = new Float32Array(frames * bins), Pp = new Float32Array(frames * bins);
    const line = new Float32Array(frames), sm = new Float32Array(frames);
    for (let k = 0; k < bins; k++) {
      for (let f = 0; f < frames; f++) line[f] = mg[f * bins + k];
      stemsMovAvg(line, sm, frames, tRad);
      for (let f = 0; f < frames; f++) Hh[f * bins + k] = sm[f];
    }
    const col = new Float32Array(bins), sc = new Float32Array(bins);
    for (let f = 0; f < frames; f++) {
      for (let k = 0; k < bins; k++) col[k] = mg[f * bins + k];
      stemsMovAvg(col, sc, bins, fRad);
      for (let k = 0; k < bins; k++) Pp[f * bins + k] = sc[k];
    }
    /* ウィーナー型 軟マスク (2乗) */
    const mh = new Float32Array(frames * bins), mp = new Float32Array(frames * bins);
    for (let i = 0; i < mh.length; i++) {
      const h = Hh[i] * Hh[i], p = Pp[i] * Pp[i];
      const d = h + p + 1e-12;
      mh[i] = h / d; mp[i] = p / d;
    }
    return { h: mh, p: mp };
  }

  function bandGains(loHz, hiHz, soft) {
    const g = new Float32Array(bins), nyq = sr / 2, sl = soft;
    for (let k = 0; k < bins; k++) {
      const hz = (k / (bins - 1)) * nyq;
      let v = 1;
      if (loHz > 0) v *= 1 / (1 + Math.pow(loHz / Math.max(1, hz), sl * 2));
      if (hiHz > 0) v *= 1 / (1 + Math.pow(hz / hiHz, sl * 2));
      g[k] = v;
    }
    return g;
  }

  report && report(0.06, 'スペクトル解析 (Mid)');
  const Sm = stft(mid);
  report && report(0.22, 'スペクトル解析 (Side)');
  const Ss = stft(side);
  report && report(0.38, '打楽器 / 楽音を分離');
  const Mm = hpss(Sm, 9, 9);
  const Ms = hpss(Ss, 9, 9);

  function build(maskM, maskS, gM, gS) {
    const m = istft(Sm, maskM, gM);
    const s = maskS ? istft(Ss, maskS, gS) : null;
    const l = new Float32Array(len), r = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      const sv = s ? s[i] : 0;
      l[i] = m[i] + sv; r[i] = m[i] - sv;
    }
    return [l, r];
  }

  report && report(0.5, 'ドラム');
  const drums = build(Mm.p, Ms.p);
  report && report(0.64, 'ベース');
  const bass = build(Mm.h, null, bandGains(0, 220, 4));
  report && report(0.76, 'ボーカル');
  const vocals = build(Mm.h, null, bandGains(170, 9000, 3));
  report && report(0.88, 'シンセ / ギター');
  const accomp = build(Mm.h, Ms.h, bandGains(200, 0, 3));
  /* ボーカルのかぶりを軽く差し引く */
  for (let c = 0; c < 2; c++) {
    const a = accomp[c], v = vocals[c];
    for (let i = 0; i < len; i++) a[i] -= v[i] * 0.55;
  }
  report && report(0.99, '完了');
  return { drums, bass, vocals, accomp };
}

/* ══════════════ ワーカー管理 ══════════════ */
let _stemWorker = null;
function stemsWorker() {
  if (_stemWorker !== null) return _stemWorker;
  try {
    const src = stemsFFT.toString() + '\n' + stemsMovAvg.toString() + '\n' + stemsCore.toString() +
      '\nself.onmessage=function(e){' +
      'var d=e.data;' +
      'var rep=function(p,l){self.postMessage({progress:p,label:l});};' +
      'var res=stemsCore(new Float32Array(d.L),new Float32Array(d.R),d.sr,d.N,d.H,rep);' +
      'var t=[];["drums","bass","vocals","accomp"].forEach(function(k){' +
      't.push(res[k][0].buffer);t.push(res[k][1].buffer);});' +
      'self.postMessage({done:true,' +
      'drums:[res.drums[0].buffer,res.drums[1].buffer],' +
      'bass:[res.bass[0].buffer,res.bass[1].buffer],' +
      'vocals:[res.vocals[0].buffer,res.vocals[1].buffer],' +
      'accomp:[res.accomp[0].buffer,res.accomp[1].buffer]},t);};';
    const blob = new Blob([src], { type: 'text/javascript' });
    _stemWorker = new Worker(URL.createObjectURL(blob));
  } catch (e) {
    _stemWorker = false;
  }
  return _stemWorker;
}

const Stems = {
  FFT_SIZE: 2048,
  HOP: 512,

  async separate(buffer, onProgress) {
    const sr = buffer.sampleRate, len = buffer.length;
    const L = buffer.getChannelData(0);
    const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
    const w = stemsWorker();

    const toBuf = pair => {
      const b = Engine.ctx.createBuffer(2, len, sr);
      b.getChannelData(0).set(pair[0]);
      b.getChannelData(1).set(pair[1]);
      return b;
    };
    const pack = res => ([
      { name: 'ドラム',        buffer: toBuf(res.drums) },
      { name: 'ベース',        buffer: toBuf(res.bass) },
      { name: 'ボーカル',      buffer: toBuf(res.vocals) },
      { name: 'シンセ/ギター', buffer: toBuf(res.accomp) }
    ]);

    if (!w) {
      /* ワーカーが使えない環境ではメインスレッドで実行 (処理中は画面が止まります) */
      U.toast('ワーカーが利用できないため、処理中は画面が停止します', 4000);
      await new Promise(r => setTimeout(r, 60));
      return pack(stemsCore(L, R, sr, this.FFT_SIZE, this.HOP, onProgress));
    }

    return new Promise((resolve, reject) => {
      w.onmessage = ev => {
        const d = ev.data;
        if (d.progress != null) { onProgress && onProgress(d.progress, d.label); return; }
        if (d.done) {
          const f = k => [new Float32Array(d[k][0]), new Float32Array(d[k][1])];
          resolve(pack({ drums: f('drums'), bass: f('bass'), vocals: f('vocals'), accomp: f('accomp') }));
        }
      };
      w.onerror = e => reject(new Error(e.message || 'ワーカーエラー'));
      const cl = new Float32Array(L), cr = new Float32Array(R);
      w.postMessage({ L: cl.buffer, R: cr.buffer, sr, N: this.FFT_SIZE, H: this.HOP },
                    [cl.buffer, cr.buffer]);
    });
  }
};

window.Stems = Stems;
window.stemsCore = stemsCore;
