/* ══════════════════════════════════════════════════════════════
   mixer.js — ミキサー (チャンネルストリップ)
   ══════════════════════════════════════════════════════════════ */
'use strict';

function makeKnob(caption, value, min, max, onChange, fmt) {
  const wrap = U.el('div', 'knob');
  const dial = U.el('div', 'knob-dial');
  const cap  = U.el('div', 'knob-cap', caption);
  const setAng = v => {
    const t = (v - min) / (max - min);
    dial.style.setProperty('--ang', (-135 + t * 270).toFixed(1) + 'deg');
    dial.title = caption + ': ' + (fmt ? fmt(v) : U.round(v, 2));
  };
  setAng(value);
  dial.onmousedown = e => {
    e.stopPropagation();
    U.dragValue(e, value, min, max, 150, v => { value = v; setAng(v); onChange(v); },
      () => Project.snapshot(caption + ' 変更'));
  };
  dial.ondblclick = e => {
    e.stopPropagation();
    const def = (min < 0 && max > 0) ? 0 : min;
    value = def; setAng(def); onChange(def);
  };
  wrap.appendChild(dial); wrap.appendChild(cap);
  wrap.__set = v => { value = v; setAng(v); };
  return wrap;
}

const Mixer = {
  strips: {},

  render() {
    const host = U.$('#mixer-strips');
    if (!host) return;
    const scrollLeft = host.scrollLeft;
    host.innerHTML = '';
    this.strips = {};
    Project.data.tracks.forEach(t => host.appendChild(this.buildStrip(t)));
    host.appendChild(this.buildMaster());
    host.scrollLeft = scrollLeft;
  },

  buildStrip(t) {
    const s = U.el('div', 'strip' + (App.selectedTrackId === t.id ? ' selected' : ''));
    s.dataset.id = t.id;
    s.onmousedown = e => { if (!e.target.closest('input,button,.knob-dial,.st-fx')) Arrange.selectTrack(t.id, false); };
    s.oncontextmenu = e => { e.preventDefault(); App.trackContextMenu(e, t); };

    /* 名前 */
    const nm = U.el('div', 'st-name', t.name);
    nm.style.borderTop = '3px solid ' + t.color;
    s.appendChild(nm);

    /* 音源 */
    const inst = U.el('div', 'st-inst', t.instrument.preset || t.instrument.engine);
    inst.title = 'クリックで音源を変更';
    inst.style.cursor = 'pointer';
    inst.onclick = () => App.instrumentPicker(t);
    s.appendChild(inst);

    /* EQ */
    const eq = U.el('div', 'st-sec');
    eq.appendChild(U.el('div', 'st-sec-cap', 'EQ'));
    const kr = U.el('div', 'st-knobrow');
    kr.appendChild(makeKnob('HI', t.eq.high, -18, 18, v => { t.eq.high = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
    kr.appendChild(makeKnob('MID', t.eq.mid, -18, 18, v => { t.eq.mid = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
    kr.appendChild(makeKnob('LO', t.eq.low, -18, 18, v => { t.eq.low = v; App.applyMix(); }, v => U.round(v, 1) + ' dB'));
    eq.appendChild(kr);
    s.appendChild(eq);

    /* インサート */
    const ins = U.el('div', 'st-sec');
    ins.appendChild(U.el('div', 'st-sec-cap', 'INSERTS'));
    (t.inserts || []).forEach((fx, i) => {
      const e = U.el('div', 'st-fx' + (fx.on === false ? ' off' : ''), FX.DEFS[fx.type].label);
      e.title = 'クリック: 設定 / 右クリック: 削除・バイパス';
      e.onclick = () => App.fxEditor(t, i);
      e.oncontextmenu = ev => {
        ev.preventDefault(); ev.stopPropagation();
        App.contextMenu(ev, [
          { label: fx.on === false ? '有効にする' : 'バイパス', fn: () => { Project.snapshot('FXバイパス'); fx.on = !(fx.on !== false); App.rebuildAudio(); } },
          { label: '削除', fn: () => { Project.snapshot('FX削除'); t.inserts.splice(i, 1); App.rebuildAudio(); } }
        ]);
      };
      ins.appendChild(e);
    });
    const add = U.el('div', 'st-fx off', '＋ 追加');
    add.onclick = () => App.fxPicker(t);
    ins.appendChild(add);
    s.appendChild(ins);

    /* センド */
    const sd = U.el('div', 'st-sec');
    sd.appendChild(U.el('div', 'st-sec-cap', 'SENDS'));
    const sr = U.el('div', 'st-knobrow');
    sr.appendChild(makeKnob('REV', t.sends.reverb, 0, 1, v => { t.sends.reverb = v; App.applyMix(); }, v => Math.round(v * 100) + '%'));
    sr.appendChild(makeKnob('DLY', t.sends.delay, 0, 1, v => { t.sends.delay = v; App.applyMix(); }, v => Math.round(v * 100) + '%'));
    sd.appendChild(sr);
    s.appendChild(sd);

    /* パン */
    const pw = U.el('div', 'st-panwrap');
    pw.appendChild(U.el('span', 'st-sec-cap', 'PAN'));
    const pan = U.el('input', 'st-pan'); pan.type = 'range';
    pan.min = -1; pan.max = 1; pan.step = 0.01; pan.value = t.pan;
    pan.oninput = e => { t.pan = +e.target.value; App.applyMix(); Arrange.renderHeaders(); };
    pan.ondblclick = () => { t.pan = 0; pan.value = 0; App.applyMix(); };
    pw.appendChild(pan);
    s.appendChild(pw);

    /* フェーダー + メーター */
    const fw = U.el('div', 'st-fadwrap');
    const fh = U.el('div', 'st-fader');
    const f = U.el('input'); f.type = 'range';
    f.min = 0; f.max = 1; f.step = 0.001; f.value = U.gainToFader(t.volume);
    f.oninput = e => {
      t.volume = U.faderToGain(+e.target.value);
      App.applyMix(); db.textContent = U.dbText(t.volume);
      Arrange.renderHeaders();
    };
    f.onmousedown = () => Project.snapshot('ボリューム変更');
    fh.appendChild(f);
    fw.appendChild(fh);
    const mtr = U.el('div', 'st-meter'); const mi = U.el('i'); mtr.appendChild(mi);
    fw.appendChild(mtr);
    s.appendChild(fw);

    const db = U.el('div', 'st-db', U.dbText(t.volume));
    s.appendChild(db);

    /* M / S / R */
    const btns = U.el('div', 'st-btns');
    const mk = (cls, label, on, fn) => {
      const b = U.el('button', 'tbtn ' + cls + (on ? ' on' : ''), label);
      b.onclick = e => { e.stopPropagation(); fn(); };
      return b;
    };
    btns.appendChild(mk('m', 'M', t.mute, () => { t.mute = !t.mute; App.applyMix(); this.render(); Arrange.renderHeaders(); }));
    btns.appendChild(mk('s', 'S', t.solo, () => { t.solo = !t.solo; App.applyMix(); this.render(); Arrange.renderHeaders(); }));
    btns.appendChild(mk('r', '●', t.armed, () => {
      t.armed = !t.armed;
      if (t.armed) Project.data.tracks.forEach(o => { if (o !== t) o.armed = false; });
      this.render(); Arrange.renderHeaders();
    }));
    s.appendChild(btns);

    this.strips[t.id] = { el: s, meter: mi, db, fader: f, pan };
    return s;
  },

  buildMaster() {
    const p = Project.data;
    const s = U.el('div', 'strip master');
    const nm = U.el('div', 'st-name', 'マスター');
    nm.style.borderTop = '3px solid #a878c8';
    s.appendChild(nm);
    s.appendChild(U.el('div', 'st-inst', 'Limiter'));

    /* リバーブ設定 */
    const rv = U.el('div', 'st-sec');
    rv.appendChild(U.el('div', 'st-sec-cap', 'REVERB BUS'));
    const rr = U.el('div', 'st-knobrow');
    rr.appendChild(makeKnob('SIZE', p.fxBus.reverb.size, 0.3, 6, v => {
      p.fxBus.reverb.size = v; clearTimeout(this._irT);
      this._irT = setTimeout(() => Engine.rebuildReverbIR(p), 220);
    }, v => U.round(v, 2) + ' s'));
    rr.appendChild(makeKnob('LVL', p.fxBus.reverb.level, 0, 1.6, v => { p.fxBus.reverb.level = v; Engine.applyBusParams(p); }, v => U.round(v, 2)));
    rv.appendChild(rr);
    s.appendChild(rv);

    /* ディレイ設定 */
    const dl = U.el('div', 'st-sec');
    dl.appendChild(U.el('div', 'st-sec-cap', 'DELAY BUS'));
    const dr = U.el('div', 'st-knobrow');
    dr.appendChild(makeKnob('FB', p.fxBus.delay.feedback, 0, 0.85, v => { p.fxBus.delay.feedback = v; Engine.applyBusParams(p); }, v => Math.round(v * 100) + '%'));
    dr.appendChild(makeKnob('LVL', p.fxBus.delay.level, 0, 1.6, v => { p.fxBus.delay.level = v; Engine.applyBusParams(p); }, v => U.round(v, 2)));
    dl.appendChild(dr);
    s.appendChild(dl);

    const fw = U.el('div', 'st-fadwrap');
    const fh = U.el('div', 'st-fader');
    const f = U.el('input'); f.type = 'range';
    f.min = 0; f.max = 1; f.step = 0.001; f.value = U.gainToFader(p.masterVolume);
    f.oninput = e => {
      p.masterVolume = U.faderToGain(+e.target.value);
      Engine.setMasterVolume(p.masterVolume);
      U.$('#master-volume').value = Math.min(1.2, p.masterVolume);
      db.textContent = U.dbText(p.masterVolume);
    };
    fh.appendChild(f); fw.appendChild(fh);
    const m1 = U.el('div', 'st-meter'); const i1 = U.el('i'); m1.appendChild(i1);
    const m2 = U.el('div', 'st-meter'); const i2 = U.el('i'); m2.appendChild(i2);
    fw.appendChild(m1); fw.appendChild(m2);
    s.appendChild(fw);
    const db = U.el('div', 'st-db', U.dbText(p.masterVolume));
    s.appendChild(db);
    this.masterMeters = [i1, i2];
    this.masterFader = f; this.masterDb = db;
    return s;
  },

  syncStrip(id) {
    const st = this.strips[id];
    const t = Project.track(id);
    if (!st || !t) return;
    st.fader.value = U.gainToFader(t.volume);
    st.pan.value = t.pan;
    st.db.textContent = U.dbText(t.volume);
  },

  /* メーター更新 (App のアニメーションループから) */
  updateMeters() {
    const mixVisible = !U.$('#editor-pane').classList.contains('hidden') &&
                       !U.$('#view-mixer').classList.contains('hidden');
    Project.data.tracks.forEach(t => {
      const ch = Engine.channel(t.id);
      if (!ch) return;
      const lvl = Engine.readMeter(ch);
      const pct = U.clamp(lvl, 0, 1) * 100;
      const hdr = document.querySelector('[data-meter="' + t.id + '"] i');
      if (hdr) hdr.style.height = pct + '%';
      if (mixVisible && this.strips[t.id]) this.strips[t.id].meter.style.height = pct + '%';
    });
    const [l, r] = Engine.readMasterMeter();
    const cb = U.$$('#master-meter-cb .mm-ch i');
    if (cb[0]) { cb[0].style.width = U.clamp(l, 0, 1) * 100 + '%'; cb[1].style.width = U.clamp(r, 0, 1) * 100 + '%'; }
    if (mixVisible && this.masterMeters) {
      this.masterMeters[0].style.height = U.clamp(l, 0, 1) * 100 + '%';
      this.masterMeters[1].style.height = U.clamp(r, 0, 1) * 100 + '%';
    }
  }
};

window.Mixer = Mixer;
window.makeKnob = makeKnob;
