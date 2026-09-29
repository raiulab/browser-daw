/* ══════════════════════════════════════════════════════════════
   arp.js — アルペジエータ (MIDI リージョンに対するオフライン適用)
     選択リージョンの和音を解析し、指定モード・レート・オクターブ幅で
     アルペジオに変換する。結果は通常のノートなので、後からピアノロールで
     自由に編集できる (取り消しも可能)。
   ══════════════════════════════════════════════════════════════ */
'use strict';

const Arp = {
  settings: {
    mode: 'up',          /* up | down | updown | downup | random | chord | played */
    rate: 0.25,          /* 拍 */
    octaves: 1,
    gate: 0.85,          /* 0.05〜1.5 */
    swing: 0,            /* 0〜0.7 */
    velMode: 'source',   /* source | fixed | accent */
    velFixed: 100,
    accent: 24,          /* アクセント量 */
    resetOnChord: true,
    destination: 'replace'  /* replace | newRegion */
  },

  RATES: [
    { v: 1,        l: '1/4' },
    { v: 0.5,      l: '1/8' },
    { v: 1 / 3,    l: '1/4 三連' },
    { v: 0.25,     l: '1/16' },
    { v: 1 / 6,    l: '1/8 三連' },
    { v: 0.125,    l: '1/32' },
    { v: 1 / 12,   l: '1/16 三連' },
    { v: 0.0625,   l: '1/64' }
  ],
  MODES: [
    { v: 'up',     l: '↑ アップ' },
    { v: 'down',   l: '↓ ダウン' },
    { v: 'updown', l: '↕ アップ→ダウン' },
    { v: 'downup', l: '↕ ダウン→アップ' },
    { v: 'random', l: '⁂ ランダム' },
    { v: 'played', l: '⇢ 入力順' },
    { v: 'chord',  l: '▦ コード (全音同時)' }
  ],

  /* 指定リージョンのノート列からアルペジオを生成して返す */
  generate(region, st) {
    st = Object.assign({}, this.settings, st || {});
    const src = region.notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    if (!src.length) return [];

    const out = [];
    const step = st.rate;
    const len = region.length;
    let counter = 0, dir = 1, lastKey = '';

    for (let i = 0; ; i++) {
      let t = i * step;
      if (t >= len - 1e-6) break;
      /* スウィング: 偶数番目でない (裏拍の) ステップを後ろへずらす */
      const swung = (i % 2 === 1) ? t + step * st.swing * 0.5 : t;
      if (swung >= len) break;

      /* この時点で鳴っている音を集める */
      const active = src.filter(n => n.start <= t + 1e-6 && n.start + n.length > t + 1e-6);
      if (!active.length) { continue; }

      /* コードが変わったらパターンをリセット */
      const key = active.map(n => n.pitch).sort((a, b) => a - b).join(',');
      if (st.resetOnChord && key !== lastKey) { counter = 0; dir = 1; lastKey = key; }

      /* オクターブ展開 */
      let pitches = [];
      const base = st.mode === 'played'
        ? active.map(n => n.pitch)
        : active.map(n => n.pitch).sort((a, b) => a - b);
      const uniq = [];
      base.forEach(p => { if (uniq.indexOf(p) < 0) uniq.push(p); });
      for (let o = 0; o < Math.max(1, st.octaves); o++) uniq.forEach(p => pitches.push(p + o * 12));

      if (st.mode === 'down') pitches = pitches.slice().reverse();

      const gateLen = Math.max(0.02, step * st.gate);
      const vAt = idx => {
        const srcNote = active[Math.min(idx, active.length - 1)];
        let v = st.velMode === 'fixed' ? st.velFixed
              : st.velMode === 'accent' ? (i % 4 === 0 ? st.velFixed : Math.max(1, st.velFixed - st.accent))
              : (srcNote ? srcNote.vel : 96);
        if (st.velMode === 'accent' && i % 4 !== 0) v = Math.max(1, v - st.accent);
        return U.clamp(Math.round(v), 1, 127);
      };

      if (st.mode === 'chord') {
        pitches.forEach((p, k) => out.push(newNote(U.clamp(p, 0, 127), swung, gateLen, vAt(k))));
        counter++;
        continue;
      }

      let idx;
      const n = pitches.length;
      if (st.mode === 'random') {
        idx = Math.floor(Math.random() * n);
      } else if (st.mode === 'updown' || st.mode === 'downup') {
        const period = Math.max(1, n * 2 - 2);
        let c = counter % period;
        if (st.mode === 'downup') c = (c + n - 1) % period;
        idx = c < n ? c : period - c;
      } else {
        idx = counter % n;
      }
      const p = pitches[U.clamp(idx, 0, n - 1)];
      out.push(newNote(U.clamp(p, 0, 127), swung, gateLen, vAt(idx % Math.max(1, active.length))));
      counter++;
    }
    return out;
  },

  /* ── ダイアログ ── */
  dialog(region, track) {
    if (!region || region.type === 'audio') { U.toast('MIDI リージョンを選択してください'); return; }
    const st = Object.assign({}, this.settings);
    let previewNotes = null;

    Modal.show('アルペジエータ — ' + region.name, body => {
      body.appendChild(ipSelect('パターン', st.mode,
        this.MODES.map(m => ({ value: m.v, label: m.l })), v => { st.mode = v; upd(); }));
      body.appendChild(ipSelect('レート', String(st.rate),
        this.RATES.map(r => ({ value: String(r.v), label: r.l })), v => { st.rate = +v; upd(); }));
      body.appendChild(ipRange('オクターブ幅', st.octaves, 1, 4, 1,
        v => { st.octaves = Math.round(v); upd(); }, v => Math.round(v) + ' オクターブ'));
      body.appendChild(ipRange('ゲート (音の長さ)', st.gate, 0.05, 1.5, 0.01,
        v => { st.gate = v; upd(); }, v => Math.round(v * 100) + '%'));
      body.appendChild(ipRange('スウィング', st.swing, 0, 0.7, 0.01,
        v => { st.swing = v; upd(); }, v => Math.round(v * 100) + '%'));
      body.appendChild(ipSelect('ベロシティ', st.velMode, [
        { value: 'source', label: '元のノートを引き継ぐ' },
        { value: 'fixed', label: '固定' },
        { value: 'accent', label: 'アクセント (4 ステップごと)' }
      ], v => { st.velMode = v; upd(); }));
      body.appendChild(ipRange('ベロシティ値', st.velFixed, 1, 127, 1,
        v => { st.velFixed = Math.round(v); upd(); }, v => Math.round(v)));
      body.appendChild(ipCheck('コードが変わったらパターンをリセット', st.resetOnChord,
        v => { st.resetOnChord = v; upd(); }));
      body.appendChild(ipSelect('出力先', st.destination, [
        { value: 'replace', label: 'このリージョンを置き換える' },
        { value: 'newRegion', label: '新しいリージョンとして追加' }
      ], v => st.destination = v));

      const cv = U.el('canvas', 'arp-preview');
      cv.style.cssText = 'width:100%;height:110px;display:block;margin-top:10px;' +
                         'background:#0d1016;border:1px solid #1a1f28;border-radius:6px;';
      body.appendChild(cv);
      const info = U.el('p', 'arp-info');
      body.appendChild(info);

      const upd = () => {
        previewNotes = this.generate(region, st);
        info.textContent = previewNotes.length + ' ノートを生成します (元: ' + region.notes.length + ' ノート)';
        this.drawPreview(cv, region, previewNotes);
      };
      setTimeout(upd, 0);
    }, [
      { label: 'キャンセル' },
      { label: '試聴', fn: () => { this.preview(track, previewNotes); return false; } },
      { label: '適用', primary: true, fn: () => {
          if (!previewNotes || !previewNotes.length) { U.toast('生成されるノートがありません'); return; }
          Object.assign(this.settings, st);
          Project.snapshot('アルペジエータ');
          if (st.destination === 'newRegion') {
            const r2 = newRegion(track.id, region.start, region.length, region.name + ' Arp');
            r2.notes = previewNotes;
            track.regions.push(r2);
            Arrange.selRegions.clear(); Arrange.selRegions.add(r2.id);
            App.refreshAll();
            PianoRoll.open(r2.id);
          } else {
            region.notes = previewNotes;
            App.refreshAll();
            if (PianoRoll.regionId === region.id) PianoRoll.render();
          }
          U.toast('アルペジオを生成しました (' + previewNotes.length + ' ノート)');
        } }
    ]);
  },

  drawPreview(cv, region, notes) {
    const w = cv.clientWidth || 400, h = 110;
    const ctx = U.fitCanvas(cv, w, h);
    ctx.fillStyle = '#0d1016'; ctx.fillRect(0, 0, w, h);
    const all = region.notes.concat(notes);
    if (!all.length) return;
    let lo = 127, hi = 0;
    all.forEach(n => { lo = Math.min(lo, n.pitch); hi = Math.max(hi, n.pitch); });
    if (hi - lo < 12) { const c = (hi + lo) / 2; lo = Math.floor(c - 6); hi = Math.ceil(c + 6); }
    const nh = Math.max(2, (h - 8) / (hi - lo + 1));
    const px = w / Math.max(0.001, region.length);

    /* 元のノート (薄いグレー) */
    ctx.fillStyle = 'rgba(150,165,185,.24)';
    region.notes.forEach(n => {
      ctx.fillRect(n.start * px, h - 4 - (n.pitch - lo + 1) * nh, Math.max(1, n.length * px), Math.max(1.5, nh - 1));
    });
    /* 生成されたノート (ネオンシアン) */
    ctx.shadowColor = '#3fc8ff'; ctx.shadowBlur = 5;
    notes.forEach(n => {
      const a = 0.45 + (n.vel / 127) * 0.55;
      ctx.fillStyle = 'rgba(108,232,255,' + a + ')';
      ctx.fillRect(n.start * px, h - 4 - (n.pitch - lo + 1) * nh, Math.max(1.5, n.length * px), Math.max(1.5, nh - 1));
    });
    ctx.shadowBlur = 0;
    /* 小節線 */
    ctx.strokeStyle = 'rgba(255,255,255,.10)';
    for (let b = 0; b < region.length; b += Project.data.sigNum) {
      const x = Math.round(b * px) + .5;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
  },

  preview(track, notes) {
    if (!notes || !notes.length || !track) return;
    const inst = Engine.instrument(track.id);
    if (!inst) return;
    const spb = 60 / Project.data.tempo;
    const t0 = Engine.ctx.currentTime + 0.06;
    const limit = Math.min(notes.length, 160);
    for (let i = 0; i < limit; i++) {
      const n = notes[i];
      if (n.start * spb > 8) break;
      inst.noteOn(n.pitch, t0 + n.start * spb, n.vel, n.length * spb);
    }
    U.toast('先頭 8 秒を試聴中');
  }
};

window.Arp = Arp;
