/* ============================================================================
   CHIPSHEET — vanilla-JS Game Boy Color music composer
   Four channels (Pulse 1, Pulse 2, Wave, Noise) on a scrolling LCD "sheet",
   a look-ahead Web Audio scheduler, and a grabbable scanline playhead.
   ========================================================================== */
(function () {
  "use strict";

  /* ----------------------------- Layout constants ----------------------- */
  const STEP_W = 22;            // px per 16th-note step
  const ROW_H = 12;             // px per semitone (pitched lanes)
  const NOISE_ROW_H = 22;       // px per drum row
  const VISIBLE_SEMIS = 25;     // semitone rows shown per pitched lane (2 octaves + C)
  const STEPS_PER_BEAT = 4;     // 16th notes
  const STEPS_PER_BAR = 16;

  const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const BLACK = new Set([1, 3, 6, 8, 10]);
  const DUTIES = [0.125, 0.25, 0.5, 0.75];
  const DUTY_LABELS = { 0.125: "12.5%", 0.25: "25%", 0.5: "50%", 0.75: "75%" };
  const WAVE_NAMES = ["Triangle", "Sawtooth", "Sine", "Pulse", "Crystal"];

  /* ------------------------------- Song model --------------------------- */
  const song = {
    bpm: 132,
    totalSteps: 64,
    loop: true,
    channels: [
      { id: "p1", name: "Pulse 1", type: "pulse", cssVar: "--c1", duty: 0.25, viewBase: 48, mute: false, rowH: ROW_H, rows: VISIBLE_SEMIS, notes: [] },
      { id: "p2", name: "Pulse 2", type: "pulse", cssVar: "--c2", duty: 0.50, viewBase: 36, mute: false, rowH: ROW_H, rows: VISIBLE_SEMIS, notes: [] },
      { id: "wv", name: "Wave",    type: "wave",  cssVar: "--c3", wave: 0,    viewBase: 48, mute: false, rowH: ROW_H, rows: VISIBLE_SEMIS, notes: [] },
      { id: "ns", name: "Noise",   type: "noise", cssVar: "--c4", viewBase: 0, mute: false, rowH: NOISE_ROW_H, rows: 4, drums: ["Open Hat", "Closed Hat", "Snare", "Kick"], notes: [] },
    ],
  };

  /* Seed a two-bar demo so Play does something immediately. */
  function seedDemo() {
    const p1 = song.channels[0], p2 = song.channels[1], wv = song.channels[2], ns = song.channels[3];
    const m = (s, l, midi) => ({ start: s, len: l, midi });
    p1.notes = [
      m(0,2,64), m(2,2,67), m(4,4,72),
      m(8,2,62), m(10,2,67), m(12,4,71),
      m(16,2,72), m(18,2,69), m(20,4,64),
      m(24,2,69), m(26,2,72), m(28,4,65),
    ];
    p2.notes = [
      m(0,3,48), m(4,3,48), m(8,3,43), m(12,3,43),
      m(16,3,45), m(20,3,45), m(24,3,41), m(28,3,41),
    ];
    wv.notes = [ m(0,8,60), m(8,8,55), m(16,8,57), m(24,8,53) ];
    const d = (s, row) => ({ start: s, len: 1, row });
    const kick = [], snare = [], hat = [];
    for (let s = 0; s < 32; s += 8) kick.push(d(s, 3));
    for (let s = 4; s < 32; s += 8) snare.push(d(s, 2));
    for (let s = 0; s < 32; s += 2) hat.push(d(s, 1));
    ns.notes = [...kick, ...snare, ...hat];
  }
  seedDemo();

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const midiName = (m) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

  /* ============================== AUDIO ENGINE =========================== */
  let ctx = null, master = null, comp = null, noiseBuffer = null;
  const pulseWaveCache = {};
  const wavePeriodic = [];
  let liveVoices = [];

  function ensureAudio() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.18;
    master = ctx.createGain();
    master.gain.value = (parseInt(volume.value, 10) / 100) * 0.9;
    master.connect(comp).connect(ctx.destination);

    // noise source buffer
    const len = Math.floor(ctx.sampleRate * 2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    // wave-channel periodic waves from 32-sample tables
    WAVE_NAMES.forEach((name, i) => { wavePeriodic[i] = tableToPeriodicWave(waveTable(name)); });
  }

  function pulseWave(duty) {
    if (pulseWaveCache[duty]) return pulseWaveCache[duty];
    const N = 48;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for (let n = 1; n < N; n++) imag[n] = (2 / (n * Math.PI)) * Math.sin(n * Math.PI * duty);
    const pw = ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    pulseWaveCache[duty] = pw;
    return pw;
  }

  function waveTable(name) {
    const N = 32, t = new Array(N);
    for (let i = 0; i < N; i++) {
      const p = i / N;
      let v = 0;
      switch (name) {
        case "Sine": v = Math.sin(2 * Math.PI * p); break;
        case "Sawtooth": v = 2 * p - 1; break;
        case "Pulse": v = p < 0.25 ? 1 : -1; break;
        case "Crystal":
          v = Math.sin(2 * Math.PI * p) + 0.45 * Math.sin(6 * Math.PI * p) + 0.2 * Math.sin(10 * Math.PI * p);
          v /= 1.65; break;
        case "Triangle":
        default: { const x = 4 * p; v = x < 1 ? x : x < 3 ? 2 - x : x - 4; }
      }
      t[i] = v;
    }
    return t;
  }

  function tableToPeriodicWave(table) {
    const N = table.length;
    const real = new Float32Array(N), imag = new Float32Array(N);
    for (let k = 0; k < N; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < N; n++) {
        const ph = (-2 * Math.PI * k * n) / N;
        re += table[n] * Math.cos(ph);
        im += table[n] * Math.sin(ph);
      }
      real[k] = re / N; imag[k] = im / N;
    }
    return ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  function track(node, gain) {
    const v = { node, gain };
    liveVoices.push(v);
    node.onended = () => { const i = liveVoices.indexOf(v); if (i >= 0) liveVoices.splice(i, 1); };
  }

  function killAll() {
    const now = ctx ? ctx.currentTime : 0;
    liveVoices.forEach((v) => {
      try {
        v.gain.gain.cancelScheduledValues(now);
        v.gain.gain.setValueAtTime(Math.max(0.0001, v.gain.gain.value), now);
        v.gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
        v.node.stop(now + 0.05);
      } catch (e) { /* already stopped */ }
    });
    liveVoices = [];
  }

  function playTone(periodic, freq, time, dur, peak) {
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(periodic);
    osc.frequency.setValueAtTime(freq, time);
    const g = ctx.createGain();
    const hold = Math.max(time + 0.004, time + dur - 0.03);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(peak, time + 0.004);
    g.gain.setValueAtTime(peak, hold);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(g).connect(master);
    osc.start(time); osc.stop(time + dur + 0.03);
    track(osc, g);
  }

  function noiseBurst(time, type, freq, q, decay, peak) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuffer;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    src.connect(f).connect(g).connect(master);
    src.start(time); src.stop(time + decay + 0.03);
    track(src, g);
  }

  function playDrum(time, drumName) {
    switch (drumName) {
      case "Kick": {
        const o = ctx.createOscillator(); o.type = "triangle";
        o.frequency.setValueAtTime(190, time);
        o.frequency.exponentialRampToValueAtTime(52, time + 0.11);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(0.55, time + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, time + 0.17);
        o.connect(g).connect(master); o.start(time); o.stop(time + 0.2); track(o, g);
        noiseBurst(time, "highpass", 1400, 0, 0.03, 0.18);
        break;
      }
      case "Snare":
        noiseBurst(time, "bandpass", 1900, 0.6, 0.18, 0.34);
        noiseBurst(time, "highpass", 3200, 0, 0.09, 0.12);
        break;
      case "Closed Hat":
        noiseBurst(time, "highpass", 7800, 0, 0.035, 0.22);
        break;
      case "Open Hat":
        noiseBurst(time, "highpass", 6500, 0, 0.22, 0.18);
        break;
    }
  }

  function triggerNote(ch, note, time) {
    if (ch.type === "pulse") playTone(pulseWave(ch.duty), midiToFreq(note.midi), time, note.len * stepDur(), 0.22);
    else if (ch.type === "wave") playTone(wavePeriodic[ch.wave], midiToFreq(note.midi), time, note.len * stepDur(), 0.2);
    else if (ch.type === "noise") playDrum(time, ch.drums[note.row]);
  }

  /* Light one-shot preview when the user drops a note. */
  function preview(ch, note) {
    ensureAudio();
    const n = ch.type === "noise" ? note : { ...note, len: 2 };
    triggerNote(ch, n, ctx.currentTime + 0.01);
  }

  /* =============================== SEQUENCER ============================= */
  const state = { playing: false };
  let timerId = null;
  let nextNoteTime = 0;          // ctx time of next step
  let stepIndexAbs = 0;          // absolute (unwrapped) step counter
  let startAbsLimit = 0;         // absolute step at which a non-looping take ends
  let position = 0;              // playhead position in steps when paused/stopped
  const anchor = { time: 0, disp: 0 };

  const stepDur = () => 60 / song.bpm / STEPS_PER_BEAT;

  const LOOKAHEAD_MS = 25, SCHEDULE_AHEAD = 0.12;

  function scheduleStep(stepIndex, time) {
    for (const ch of song.channels) {
      if (ch.mute) continue;
      for (const note of ch.notes) if (note.start === stepIndex) triggerNote(ch, note, time);
    }
  }

  function scheduler() {
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD) {
      if (!song.loop && stepIndexAbs >= startAbsLimit) {
        const stopAt = nextNoteTime;
        const ms = Math.max(0, (stopAt - ctx.currentTime) * 1000);
        setTimeout(() => { if (state.playing) stopAtEnd(); }, ms + 40);
        return;
      }
      scheduleStep(stepIndexAbs % song.totalSteps, nextNoteTime);
      anchor.time = nextNoteTime; anchor.disp = stepIndexAbs;
      nextNoteTime += stepDur();
      stepIndexAbs++;
    }
  }

  function startPlayback(fromStep) {
    ensureAudio();
    state.playing = true;
    stepIndexAbs = Math.round(fromStep);
    startAbsLimit = song.totalSteps; // play to the end of the sheet
    nextNoteTime = ctx.currentTime + 0.08;
    anchor.time = nextNoteTime; anchor.disp = stepIndexAbs;
    clearInterval(timerId);
    timerId = setInterval(scheduler, LOOKAHEAD_MS);
    scheduler();
    setPlayButton(true);
  }

  function play(fromStep) { if (state.playing) return; startPlayback(fromStep == null ? position : fromStep); }

  function pause() {
    if (!state.playing) return;
    position = currentDisplay();
    state.playing = false;
    clearInterval(timerId); timerId = null;
    killAll();
    setPlayButton(false);
  }

  function stop() {
    state.playing = false;
    clearInterval(timerId); timerId = null;
    killAll();
    position = 0;
    setPlayButton(false);
    updatePlayhead();
  }

  function stopAtEnd() {
    state.playing = false;
    clearInterval(timerId); timerId = null;
    killAll();
    position = 0;
    setPlayButton(false);
  }

  function restart() { pause(); position = 0; play(0); }

  function togglePlay() { if (state.playing) pause(); else play(position); }

  function currentDisplay() {
    if (!ctx || !state.playing) return position;
    let disp = anchor.disp + (ctx.currentTime - anchor.time) / stepDur();
    disp = Math.max(0, disp);
    if (song.loop) disp = disp % song.totalSteps;
    else disp = Math.min(disp, song.totalSteps);
    return disp;
  }

  /* ============================ DOM REFERENCES ========================== */
  const editor = document.getElementById("editor");
  const mainVp = document.getElementById("mainVp");
  const rulerVp = document.getElementById("rulerVp");
  const gutterVp = document.getElementById("gutterVp");
  const sheet = document.getElementById("sheet");
  const lanesEl = document.getElementById("lanes");
  const gutterEl = document.getElementById("gutter");
  const rulerEl = document.getElementById("ruler");
  const playhead = document.getElementById("playhead");

  const tempo = document.getElementById("tempo");
  const tempoVal = document.getElementById("tempoVal");
  const volume = document.getElementById("volume");
  const volVal = document.getElementById("volVal");

  function laneHeight(ch) { return ch.rows * ch.rowH; }
  function sheetWidth() { return song.totalSteps * STEP_W; }

  /* ============================== RENDERING ============================= */
  function buildRuler() {
    rulerEl.style.width = sheetWidth() + "px";
    rulerEl.innerHTML = "";
    for (let s = 0; s <= song.totalSteps; s++) {
      const x = s * STEP_W;
      if (s % STEPS_PER_BAR === 0) {
        const t = document.createElement("div"); t.className = "bar-tick"; t.style.left = x + "px"; rulerEl.appendChild(t);
        if (s < song.totalSteps) {
          const n = document.createElement("div"); n.className = "bar-num";
          n.style.left = x + "px"; n.textContent = (s / STEPS_PER_BAR) + 1; rulerEl.appendChild(n);
        }
      } else if (s % STEPS_PER_BEAT === 0) {
        const t = document.createElement("div"); t.className = "beat-tick"; t.style.left = x + "px"; rulerEl.appendChild(t);
      }
    }
    rulerEl.classList.add("scrub-target");
  }

  function laneBackground(ch) {
    const step = `repeating-linear-gradient(90deg, var(--line) 0 1px, transparent 1px ${STEP_W}px)`;
    const beat = `repeating-linear-gradient(90deg, var(--line-beat) 0 1px, transparent 1px ${STEP_W * STEPS_PER_BEAT}px)`;
    const bar = `repeating-linear-gradient(90deg, var(--line-bar) 0 1px, transparent 1px ${STEP_W * STEPS_PER_BAR}px)`;
    return `${bar}, ${beat}, ${step}`;
  }

  function buildLanes() {
    sheet.style.width = sheetWidth() + "px";
    let total = 0;
    song.channels.forEach((ch) => { total += laneHeight(ch); });
    sheet.style.height = total + "px";
    lanesEl.innerHTML = "";
    song.channels.forEach((ch) => {
      const lane = document.createElement("div");
      lane.className = "lane";
      lane.style.width = sheetWidth() + "px";
      lane.style.height = laneHeight(ch) + "px";
      lane.style.backgroundImage = laneBackground(ch);
      lane.style.setProperty("--ch", `var(${ch.cssVar})`);
      ch._lane = lane;
      lanesEl.appendChild(lane);
      attachLaneEditing(ch, lane);
      renderBands(ch);
      renderNotes(ch);
    });
  }

  function renderBands(ch) {
    const lane = ch._lane;
    lane.querySelectorAll(".row-band").forEach((e) => e.remove());
    if (ch.type === "noise") {
      for (let i = 0; i < ch.rows; i++) {
        if (i % 2 === 1) {
          const b = document.createElement("div");
          b.className = "row-band black";
          b.style.top = i * ch.rowH + "px"; b.style.height = ch.rowH + "px";
          lane.insertBefore(b, lane.firstChild);
        }
      }
      return;
    }
    for (let i = 0; i < ch.rows; i++) {
      const midi = ch.viewBase + (ch.rows - 1 - i);
      const pc = ((midi % 12) + 12) % 12;
      let cls = "row-band";
      if (BLACK.has(pc)) cls += " black";
      if (pc === 0) cls += " cline";
      if (cls === "row-band") continue;
      const b = document.createElement("div");
      b.className = cls;
      b.style.top = i * ch.rowH + "px"; b.style.height = ch.rowH + "px";
      lane.insertBefore(b, lane.firstChild);
    }
  }

  function noteRowIndex(ch, note) {
    if (ch.type === "noise") return note.row;
    return (ch.rows - 1) - (note.midi - ch.viewBase);
  }

  function renderNotes(ch) {
    const lane = ch._lane;
    lane.querySelectorAll(".note").forEach((e) => e.remove());
    ch.notes.forEach((note) => {
      const row = noteRowIndex(ch, note);
      if (row < 0 || row >= ch.rows) return; // outside visible window (still plays)
      const el = document.createElement("div");
      el.className = "note";
      el.style.left = note.start * STEP_W + "px";
      el.style.top = row * ch.rowH + "px";
      el.style.width = Math.max(3, note.len * STEP_W - 2) + "px";
      el.style.height = (ch.rowH - 2) + "px";
      note._el = el;
      lane.appendChild(el);
    });
  }

  function buildGutter() {
    let total = 0; song.channels.forEach((ch) => { total += laneHeight(ch); });
    gutterEl.style.height = total + "px";
    gutterEl.innerHTML = "";
    song.channels.forEach((ch) => {
      const head = document.createElement("div");
      head.className = "lane-head";
      head.style.height = laneHeight(ch) + "px";
      head.style.setProperty("--ch", `var(${ch.cssVar})`);
      ch._head = head;
      gutterEl.appendChild(head);
      renderGutterHead(ch);
    });
  }

  function renderGutterHead(ch) {
    const head = ch._head;
    head.innerHTML = "";

    // pitch / drum reference
    if (ch.type === "noise") {
      ch.drums.forEach((name, i) => {
        const d = document.createElement("div");
        d.className = "drumlabel";
        d.style.top = i * ch.rowH + "px"; d.style.height = ch.rowH + "px";
        d.textContent = name;
        head.appendChild(d);
      });
    } else {
      const keys = document.createElement("div");
      keys.className = "lh-keys";
      keys.style.height = laneHeight(ch) + "px";
      for (let i = 0; i < ch.rows; i++) {
        const midi = ch.viewBase + (ch.rows - 1 - i);
        const pc = ((midi % 12) + 12) % 12;
        const k = document.createElement("div");
        k.className = "key" + (BLACK.has(pc) ? " kbg-black" : "") + (pc === 0 ? " cnote" : "");
        k.style.top = i * ch.rowH + "px"; k.style.height = ch.rowH + "px";
        if (pc === 0) { const s = document.createElement("span"); s.className = "knote"; s.textContent = midiName(midi); k.appendChild(s); }
        keys.appendChild(k);
      }
      head.appendChild(keys);
    }

    // header block (name + controls), sits over the top rows
    const top = document.createElement("div");
    top.className = "lh-top";
    top.innerHTML = `<span class="lh-dot"></span><span class="lh-name">${ch.name}</span>`;
    head.appendChild(top);

    const controls = document.createElement("div");
    controls.className = "lh-controls";

    const mute = document.createElement("button");
    mute.className = "mini" + (ch.mute ? " muted" : " on");
    mute.textContent = ch.mute ? "Muted" : "On";
    mute.title = "Mute / unmute this channel";
    mute.onclick = () => { ch.mute = !ch.mute; renderGutterHead(ch); };
    controls.appendChild(mute);

    if (ch.type === "pulse") {
      const sel = document.createElement("select"); sel.className = "mini";
      DUTIES.forEach((d) => { const o = document.createElement("option"); o.value = d; o.textContent = "Duty " + DUTY_LABELS[d]; if (d === ch.duty) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { ch.duty = parseFloat(sel.value); };
      controls.appendChild(sel);
    } else if (ch.type === "wave") {
      const sel = document.createElement("select"); sel.className = "mini";
      WAVE_NAMES.forEach((n, i) => { const o = document.createElement("option"); o.value = i; o.textContent = n; if (i === ch.wave) o.selected = true; sel.appendChild(o); });
      sel.onchange = () => { ch.wave = parseInt(sel.value, 10); };
      controls.appendChild(sel);
    }

    if (ch.type !== "noise") {
      const oct = document.createElement("span"); oct.className = "lh-oct";
      const down = document.createElement("button"); down.className = "mini"; down.textContent = "8va\u2193"; down.title = "Octave down";
      const up = document.createElement("button"); up.className = "mini"; up.textContent = "8va\u2191"; up.title = "Octave up";
      down.onclick = () => shiftOctave(ch, -12);
      up.onclick = () => shiftOctave(ch, +12);
      oct.appendChild(down); oct.appendChild(up);
      controls.appendChild(oct);
    }
    head.appendChild(controls);
  }

  function shiftOctave(ch, delta) {
    const nb = ch.viewBase + delta;
    if (nb < 12 || nb + ch.rows - 1 > 108) return;
    ch.viewBase = nb;
    renderBands(ch); renderNotes(ch); renderGutterHead(ch);
  }

  /* ============================ NOTE EDITING ============================ */
  let edit = null; // { ch, note, anchorStep }

  function cellFromEvent(ch, lane, e) {
    const r = lane.getBoundingClientRect();
    let step = Math.floor((e.clientX - r.left) / STEP_W);
    let row = Math.floor((e.clientY - r.top) / ch.rowH);
    step = Math.max(0, Math.min(song.totalSteps - 1, step));
    row = Math.max(0, Math.min(ch.rows - 1, row));
    return { step, row };
  }

  function findNote(ch, step, row) {
    for (const n of ch.notes) {
      const nr = noteRowIndex(ch, n);
      if (nr === row && n.start <= step && step < n.start + n.len) return n;
    }
    return null;
  }

  function attachLaneEditing(ch, lane) {
    lane.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const { step, row } = cellFromEvent(ch, lane, e);
      const existing = findNote(ch, step, row);
      if (existing) {
        ch.notes.splice(ch.notes.indexOf(existing), 1);
        renderNotes(ch);
        return;
      }
      let note;
      if (ch.type === "noise") note = { start: step, len: 1, row };
      else note = { start: step, len: 1, midi: ch.viewBase + (ch.rows - 1 - row) };
      ch.notes.push(note);
      renderNotes(ch);
      preview(ch, note);
      if (ch.type === "noise") return; // drums are one-shot, no length drag
      edit = { ch, note, anchorStep: step };
      lane.setPointerCapture(e.pointerId);
    });

    lane.addEventListener("pointermove", (e) => {
      if (!edit || edit.ch !== ch) return;
      const { step } = cellFromEvent(ch, lane, e);
      let len = step - edit.anchorStep + 1;
      len = Math.max(1, Math.min(song.totalSteps - edit.note.start, len));
      if (len !== edit.note.len) { edit.note.len = len; renderNotes(ch); }
    });

    const endEdit = (e) => { if (edit && edit.ch === ch) { try { lane.releasePointerCapture(e.pointerId); } catch (x) {} edit = null; } };
    lane.addEventListener("pointerup", endEdit);
    lane.addEventListener("pointercancel", endEdit);
  }

  /* ====================== PLAYHEAD / SCRUBBING ========================= */
  const scrub = { active: false, wasPlaying: false };

  function posFromClientX(clientX) {
    const r = sheet.getBoundingClientRect();
    let s = (clientX - r.left) / STEP_W;
    return Math.max(0, Math.min(song.totalSteps, s));
  }

  function startScrub(e) {
    e.preventDefault();
    scrub.active = true;
    scrub.wasPlaying = state.playing;
    if (state.playing) pause();
    position = posFromClientX(e.clientX);
    playhead.classList.add("grabbing");
    updatePlayhead();
  }

  playhead.addEventListener("pointerdown", startScrub);
  rulerEl.addEventListener("pointerdown", startScrub);

  window.addEventListener("pointermove", (e) => {
    if (!scrub.active) return;
    position = posFromClientX(e.clientX);
    updatePlayhead();
  });

  window.addEventListener("pointerup", () => {
    if (!scrub.active) return;
    scrub.active = false;
    playhead.classList.remove("grabbing");
    if (scrub.wasPlaying) play(position);
  });

  function updatePlayhead() {
    const disp = state.playing ? currentDisplay() : position;
    playhead.style.transform = `translateX(${disp * STEP_W}px)`;
  }

  function autoFollow() {
    const disp = currentDisplay();
    const x = disp * STEP_W;
    const left = mainVp.scrollLeft, right = left + mainVp.clientWidth;
    if (x > right - 60) mainVp.scrollLeft = Math.min(x - 60, sheetWidth() - mainVp.clientWidth);
    else if (x < left) mainVp.scrollLeft = Math.max(0, x - 40);
  }

  function frame() {
    updatePlayhead();
    if (state.playing && !scrub.active) autoFollow();
    requestAnimationFrame(frame);
  }

  /* ============================ SCROLL SYNC ============================ */
  mainVp.addEventListener("scroll", () => {
    rulerVp.scrollLeft = mainVp.scrollLeft;
    gutterVp.scrollTop = mainVp.scrollTop;
  });

  /* =========================== TRANSPORT UI =========================== */
  const btnPlay = document.getElementById("btnPlay");
  const btnStop = document.getElementById("btnStop");
  const btnRestart = document.getElementById("btnRestart");
  const btnLoop = document.getElementById("btnLoop");
  const btnClear = document.getElementById("btnClear");

  function setPlayButton(playing) {
    btnPlay.classList.toggle("is-playing", playing);
    const label = btnPlay.querySelector("span");
    const icon = btnPlay.querySelector("svg path, svg rect");
    btnPlay.querySelector("svg").innerHTML = playing
      ? '<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>'
      : '<path d="M8 5v14l11-7z"/>';
    if (label) label.textContent = playing ? "Pause" : "Play";
  }

  btnPlay.onclick = () => togglePlay();
  btnStop.onclick = () => stop();
  btnRestart.onclick = () => restart();
  btnLoop.onclick = () => {
    song.loop = !song.loop;
    btnLoop.setAttribute("aria-pressed", String(song.loop));
  };
  btnClear.onclick = () => {
    if (!confirm("Remove every note from all four channels?")) return;
    song.channels.forEach((ch) => { ch.notes = []; renderNotes(ch); });
  };

  tempo.addEventListener("input", () => { song.bpm = parseInt(tempo.value, 10); tempoVal.textContent = tempo.value; });
  volume.addEventListener("input", () => {
    volVal.textContent = volume.value;
    if (master) master.gain.value = (parseInt(volume.value, 10) / 100) * 0.9;
  });

  window.addEventListener("keydown", (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    else if (e.key === "Enter") { e.preventDefault(); restart(); }
  });

  /* ============================== C EXPORT ============================ */
  // Game Boy 11-bit frequency register value for a MIDI note.
  // freq = 131072 / (2048 - x)  ->  x = 2048 - 131072/freq
  function midiToGbPeriod(midi) {
    const f = midiToFreq(midi);
    const raw = Math.round(2048 - 131072 / f);
    return { value: Math.max(0, Math.min(2047, raw)), ok: raw >= 0 && raw <= 2047 };
  }
  // 32 samples (-1..1) -> 16 bytes of 4-bit GB Wave RAM (high nibble first).
  function waveRamBytes(presetIdx) {
    const t = waveTable(WAVE_NAMES[presetIdx] || "Triangle");
    const nib = t.map((v) => Math.max(0, Math.min(15, Math.round(((v + 1) / 2) * 15))));
    const out = [];
    for (let i = 0; i < 32; i += 2) out.push((nib[i] << 4) | nib[i + 1]);
    return out;
  }
  const hx = (n, w) => "0x" + (n >>> 0).toString(16).toUpperCase().padStart(w, "0");
  const pad = (n, w) => String(n).padStart(w, " ");

  // Suggested noise registers per drum id (starting points, tune to taste).
  // drums order: 0 Open Hat, 1 Closed Hat, 2 Snare, 3 Kick
  const DRUM_NR42 = [0xa4, 0xa1, 0xb6, 0xf3];
  const DRUM_NR43 = [0x21, 0x21, 0x48, 0x57];

  function chanArray(ch) {
    const id = ch.id.toUpperCase();
    const notes = ch.notes.slice().sort((a, b) => a.start - b.start || ((a.midi ?? a.row) - (b.midi ?? b.row)));
    const L = [];
    if (ch.type === "pulse") {
      const duty = Math.max(0, DUTIES.indexOf(ch.duty));
      L.push(`/* ---- ${ch.name} ---- square wave, duty ${duty} (${DUTY_LABELS[ch.duty]}) */`);
      L.push(`#define ${id}_DUTY        ${duty}`);
    } else if (ch.type === "wave") {
      const bytes = waveRamBytes(ch.wave);
      L.push(`/* ---- ${ch.name} ---- preset "${WAVE_NAMES[ch.wave]}".`);
      L.push(`   Copy these 16 bytes into Wave RAM (0xFF30-0xFF3F) before playing. */`);
      L.push(`const unsigned char ${ch.id}_wave_ram[16] = {`);
      L.push("    " + bytes.map((b) => hx(b, 2)).join(", "));
      L.push("};");
    } else {
      L.push(`/* ---- ${ch.name} ---- drums. note field = drum id:`);
      L.push(`     ${ch.drums.map((d, i) => i + "=" + d).join(", ")}`);
      L.push(`   drum_nr42/drum_nr43 below are suggested starting registers. */`);
      L.push(`const unsigned char drum_nr42[4] = { ${DRUM_NR42.map((b) => hx(b, 2)).join(", ")} };`);
      L.push(`const unsigned char drum_nr43[4] = { ${DRUM_NR43.map((b) => hx(b, 2)).join(", ")} };`);
    }

    L.push(`#define ${id}_NOTE_COUNT  ${notes.length}`);
    if (!notes.length) {
      L.push(`const ChipNote ${ch.id}_notes[1] = { {0, 0, 0, 0} }; /* empty */`);
      return L.join("\n");
    }
    L.push(`const ChipNote ${ch.id}_notes[${id}_NOTE_COUNT] = {`);
    L.push(`    /* start  len  note  period */`);
    for (const n of notes) {
      if (ch.type === "noise") {
        L.push(`    { ${pad(n.start, 4)}, ${pad(n.len, 3)}, ${pad(n.row, 4)}, ${pad(0, 6)} }, /* ${ch.drums[n.row]} */`);
      } else {
        const p = midiToGbPeriod(n.midi);
        const note = `${midiName(n.midi)}${p.ok ? "" : " - below GB range"}`;
        L.push(`    { ${pad(n.start, 4)}, ${pad(n.len, 3)}, ${pad(n.midi, 4)}, ${pad(p.value, 6)} }, /* ${note} */`);
      }
    }
    L.push("};");
    return L.join("\n");
  }

  function buildCExport() {
    const msPerStep = Math.round(60000 / (song.bpm * STEPS_PER_BEAT));
    const head = [
      "/* ============================================================",
      "   CHIPSHEET export - Game Boy Color song data",
      "   Generated for a GBDK / homebrew project.",
      "   1 step = one 16th note.  Trigger a note when the step",
      "   counter reaches its `start`.",
      "   ============================================================ */",
      "",
      `#define SONG_BPM            ${song.bpm}`,
      `#define SONG_TOTAL_STEPS    ${song.totalSteps}`,
      `#define SONG_STEPS_PER_BEAT ${STEPS_PER_BEAT}`,
      `#define SONG_LOOP           ${song.loop ? 1 : 0}`,
      `#define SONG_MS_PER_STEP    ${msPerStep}   /* 60000 / (BPM * ${STEPS_PER_BEAT}) */`,
      "",
      "/* One note / drum hit on a channel.",
      "   start  : step it begins on (0..SONG_TOTAL_STEPS-1)",
      "   length : duration in steps",
      "   note   : MIDI note (pitched channels) OR drum id (noise)",
      "   period : GB 11-bit frequency for NRx3/NRx4 (pitched only) */",
      "typedef struct {",
      "    unsigned char  start;",
      "    unsigned char  length;",
      "    unsigned char  note;",
      "    unsigned short period;",
      "} ChipNote;",
    ].join("\n");

    const tail = [
      "/* ----------------------------------------------------------------",
      "   Playing it back (sketch):",
      "     Keep a step counter; advance it every SONG_MS_PER_STEP ms.",
      "     When step == note.start, trigger it on its channel:",
      "",
      "       square (Pulse 1 = NR11-NR14, Pulse 2 = NR21-NR24):",
      "         NRx1 = (Px_DUTY << 6);",
      "         NRx2 = 0xF0;                      (full volume)",
      "         NRx3 = note.period & 0xFF;",
      "         NRx4 = 0x80 | (note.period >> 8); (0x80 = trigger)",
      "",
      "       wave (NR30-NR34): load wv_wave_ram into 0xFF30-0xFF3F once;",
      "         NR30 = 0x80;                      (channel on)",
      "         NR32 = 0x20;                      (full volume)",
      "         NR33 = note.period & 0xFF;",
      "         NR34 = 0x80 | (note.period >> 8);",
      "",
      "       noise (NR41-NR44):",
      "         NR42 = drum_nr42[note.note];",
      "         NR43 = drum_nr43[note.note];",
      "         NR44 = 0x80;                      (trigger)",
      "",
      "     At step == SONG_TOTAL_STEPS, wrap to 0 if SONG_LOOP.",
      "   ---------------------------------------------------------------- */",
    ].join("\n");

    const blocks = song.channels.map(chanArray).join("\n\n");
    return head + "\n\n" + blocks + "\n\n" + tail + "\n";
  }

  const btnExport = document.getElementById("btnExport");
  const exportDlg = document.getElementById("exportDlg");
  const exportPre = document.getElementById("exportPre");
  const btnCopyC = document.getElementById("btnCopyC");
  const btnCloseC = document.getElementById("btnCloseC");

  btnExport.onclick = () => {
    exportPre.textContent = buildCExport();
    btnCopyC.textContent = "Copy";
    if (typeof exportDlg.showModal === "function") exportDlg.showModal();
    else exportDlg.setAttribute("open", "");
  };
  btnCloseC.onclick = () => { if (exportDlg.close) exportDlg.close(); else exportDlg.removeAttribute("open"); };
  exportDlg.addEventListener("click", (e) => { if (e.target === exportDlg) btnCloseC.onclick(); });
  btnCopyC.onclick = async () => {
    const text = exportPre.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      const r = document.createRange(); r.selectNodeContents(exportPre);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      try { document.execCommand("copy"); sel.removeAllRanges(); } catch (e2) {}
    }
    btnCopyC.textContent = "Copied!";
    setTimeout(() => { btnCopyC.textContent = "Copy"; }, 1400);
  };

  /* ============================== PRESETS ============================= */
  // Compact authoring: note tokens "C#5:4" (name:lengthInSteps), "r:N" = rest.
  // Melodies are public-domain (folk/classical) or original; Tetris uses the
  // traditional Russian song "Korobeiniki". No copyrighted game music.
  function noteToMidi(s) {
    const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(s.trim());
    const base = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[m[1].toLowerCase()];
    const acc = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
    return base + acc + (parseInt(m[3], 10) + 1) * 12;
  }
  function buildLane(tokens) {
    let t = 0; const out = [];
    tokens.forEach((tok) => {
      const i = tok.lastIndexOf(":");
      const nm = tok.slice(0, i), len = parseInt(tok.slice(i + 1), 10);
      if (nm !== "r") out.push({ start: t, len, midi: noteToMidi(nm) });
      t += len;
    });
    return out;
  }
  function drumNotes(patterns, steps) {
    const rowOf = { kick: 3, snare: 2, hat: 1, open: 0 };
    const out = [];
    Object.keys(patterns).forEach((k) => {
      const pat = patterns[k]; if (!pat) return; const row = rowOf[k];
      for (let i = 0; i < steps; i++) if (pat[i % pat.length] === "x") out.push({ start: i, len: 1, row });
    });
    return out;
  }
  function fitViewBase(notes, rows) {
    if (!notes.length) return null;
    let lo = Infinity, hi = -Infinity;
    notes.forEach((n) => { lo = Math.min(lo, n.midi); hi = Math.max(hi, n.midi); });
    const slack = Math.max(0, (rows - 1) - (hi - lo));
    let base = lo - Math.floor(slack / 2);
    base = Math.max(hi - rows + 1, Math.min(lo, base));
    return Math.max(12, Math.min(108 - rows + 1, base));
  }

  const PRESETS = [
    {
      name: "Tetris", tag: "Korobeiniki", bpm: 150, steps: 128,
      p1: { duty: 0.5, tokens: [
        "E5:4","B4:2","C5:2","D5:4","C5:2","B4:2", "A4:4","A4:2","C5:2","E5:4","D5:2","C5:2",
        "B4:6","C5:2","D5:4","E5:4", "C5:4","A4:4","A4:8",
        "r:2","D5:4","F5:2","A5:4","G5:2","F5:2", "E5:6","C5:2","E5:4","D5:2","C5:2",
        "B4:4","B4:2","C5:2","D5:4","E5:4", "C5:4","A4:4","A4:8" ] },
      p2: { duty: 0.5, tokens: [
        "E2:4","B2:4","E2:4","B2:4", "A2:4","E3:4","A2:4","E3:4", "B2:4","F#3:4","B2:4","F#3:4", "E2:4","B2:4","E2:4","B2:4",
        "D2:4","A2:4","D2:4","A2:4", "A2:4","E3:4","A2:4","E3:4", "B2:4","F#3:4","B2:4","F#3:4", "E2:4","B2:4","E2:8" ] },
      drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
    },
    {
      name: "Ode to Joy", tag: "Beethoven", bpm: 120, steps: 128,
      p1: { duty: 0.5, tokens: [
        "E4:4","E4:4","F4:4","G4:4", "G4:4","F4:4","E4:4","D4:4", "C4:4","C4:4","D4:4","E4:4", "E4:6","D4:2","D4:8",
        "E4:4","E4:4","F4:4","G4:4", "G4:4","F4:4","E4:4","D4:4", "C4:4","C4:4","D4:4","E4:4", "D4:6","C4:2","C4:8" ] },
      p2: { duty: 0.5, tokens: [
        "C3:4","G3:4","C3:4","G3:4", "G2:4","D3:4","G2:4","D3:4", "C3:4","G3:4","C3:4","G3:4", "G2:4","D3:4","G2:8",
        "C3:4","G3:4","C3:4","G3:4", "G2:4","D3:4","G2:4","D3:4", "C3:4","G3:4","C3:4","G3:4", "C3:4","G3:4","C3:8" ] },
      wv: { copyOf: "p1", transpose: -12, wave: 2 },
      drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
    },
    {
      name: "Canon in D", tag: "Pachelbel", bpm: 96, steps: 128,
      p1: { duty: 0.5, tokens: [
        "F#5:4","E5:4","D5:4","C#5:4","B4:4","A4:4","B4:4","C#5:4","D5:4","C#5:4","B4:4","A4:4","G4:4","F#4:4","G4:4","A4:4",
        "F#5:4","E5:4","D5:4","C#5:4","B4:4","A4:4","B4:4","C#5:4","D5:4","C#5:4","B4:4","A4:4","G4:4","F#4:4","G4:4","A4:4" ] },
      p2: { duty: 0.5, tokens: [
        "D2:8","A2:8","B2:8","F#2:8","G2:8","D2:8","G2:8","A2:8",
        "D2:8","A2:8","B2:8","F#2:8","G2:8","D2:8","G2:8","A2:8" ] },
    },
    {
      name: "Frere Jacques", tag: "round · trad.", bpm: 112, steps: 192,
      p1: { duty: 0.5, tokens: [
        "C4:4","D4:4","E4:4","C4:4","C4:4","D4:4","E4:4","C4:4",
        "E4:4","F4:4","G4:8","E4:4","F4:4","G4:8",
        "G4:2","A4:2","G4:2","F4:2","E4:4","C4:4","G4:2","A4:2","G4:2","F4:2","E4:4","C4:4",
        "C4:4","G3:4","C4:8","C4:4","G3:4","C4:8" ] },
      p2: { copyOf: "p1", offset: 32, transpose: -12 },
      wv: { copyOf: "p1", offset: 64, transpose: -12, wave: 0 },
      drums: { hat: "x...x...x...x..." },
    },
    {
      name: "Jingle Bells", tag: "Pierpont", bpm: 144, steps: 128,
      p1: { duty: 0.25, tokens: [
        "E4:4","E4:4","E4:8", "E4:4","E4:4","E4:8", "E4:4","G4:4","C4:6","D4:2", "E4:16",
        "F4:4","F4:4","F4:4","F4:4", "F4:4","E4:4","E4:4","E4:4", "E4:4","D4:4","D4:4","E4:4", "D4:8","G4:8" ] },
      p2: { duty: 0.5, tokens: [
        "C3:4","G3:4","C3:4","G3:4", "C3:4","G3:4","C3:4","G3:4", "C3:4","G3:4","C3:4","G3:4", "C3:4","G3:4","C3:4","G3:4",
        "F2:4","C3:4","F2:4","C3:4", "C3:4","G3:4","C3:4","G3:4", "G2:4","D3:4","G2:4","D3:4", "G2:8","C3:8" ] },
      drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x." },
    },
    {
      name: "Fur Elise", tag: "Beethoven", bpm: 76, steps: 96,
      p1: { duty: 0.5, tokens: [
        "E5:2","D#5:2","E5:2","D#5:2","E5:2","B4:2","D5:2","C5:2",
        "A4:4","r:2","C4:2","E4:2","A4:2","B4:4",
        "r:2","E4:2","G#4:2","B4:2","C5:4","r:4",
        "E5:2","D#5:2","E5:2","D#5:2","E5:2","B4:2","D5:2","C5:2",
        "A4:4","r:2","C4:2","E4:2","A4:2","B4:4",
        "r:2","E4:2","C5:2","B4:2","A4:8" ] },
      p2: { duty: 0.5, tokens: [
        "r:16",
        "A2:2","E3:2","A3:2","E3:2","E2:2","E3:2","G#3:2","E3:2",
        "E2:2","E3:2","G#3:2","E3:2","A2:2","E3:2","A3:2","E3:2",
        "r:16",
        "A2:2","E3:2","A3:2","E3:2","E2:2","E3:2","G#3:2","E3:2",
        "A2:2","E3:2","A3:2","E3:2","A2:8" ] },
    },
    {
      name: "Pixel Quest", tag: "original", bpm: 150, steps: 64,
      p1: { duty: 0.25, tokens: [
        "C5:2","E5:2","G5:2","E5:2","C5:2","E5:2","G5:4",
        "A4:2","C5:2","E5:2","C5:2","A4:2","C5:2","E5:4",
        "G4:2","B4:2","D5:2","B4:2","G4:2","B4:2","D5:4",
        "C5:4","G4:4","E4:4","C4:4" ] },
      p2: { duty: 0.5, tokens: [
        "C2:2","C3:2","C2:2","C3:2","C2:2","C3:2","C2:2","C3:2",
        "A2:2","A3:2","A2:2","A3:2","A2:2","A3:2","A2:2","A3:2",
        "G2:2","G3:2","G2:2","G3:2","G2:2","G3:2","G2:2","G3:2",
        "C2:2","C3:2","C2:2","C3:2","G2:2","G3:2","G2:2","G3:2" ] },
      wv: { copyOf: "p1", transpose: -12, wave: 0 },
      drums: { kick: "x...x...x...x...", snare: "....x.......x...", hat: "x.x.x.x.x.x.x.x.", open: "..............x." },
    },
  ];

  function applyPreset(p) {
    stop();
    song.bpm = p.bpm; song.totalSteps = p.steps; song.loop = p.loop !== false;
    const byId = {}; song.channels.forEach((c) => { byId[c.id] = c; c.notes = []; c.mute = false; });

    function setPitched(ch, spec) {
      if (!spec) { ch.notes = []; ch._pre = []; return; }
      let notes;
      if (spec.copyOf) {
        const src = byId[spec.copyOf]._pre || [];
        notes = src.map((n) => ({ start: n.start + (spec.offset || 0), len: n.len, midi: n.midi + (spec.transpose || 0) }));
      } else notes = buildLane(spec.tokens);
      ch._pre = notes; ch.notes = notes;
      if (ch.type === "pulse" && spec.duty != null) ch.duty = spec.duty;
      if (ch.type === "wave" && spec.wave != null) ch.wave = spec.wave;
      const b = fitViewBase(notes, ch.rows); if (b != null) ch.viewBase = b;
    }
    setPitched(byId.p1, p.p1);
    setPitched(byId.p2, p.p2);
    setPitched(byId.wv, p.wv);
    byId.ns.notes = p.drums ? drumNotes(p.drums, song.totalSteps) : [];

    buildRuler(); buildLanes(); buildGutter();
    tempo.value = song.bpm; tempoVal.textContent = song.bpm;
    btnLoop.setAttribute("aria-pressed", String(song.loop));
    position = 0; updatePlayhead();
    mainVp.scrollLeft = 0; rulerVp.scrollLeft = 0; gutterVp.scrollTop = 0;
  }

  (function buildPresetBar() {
    const bar = document.getElementById("presetbar");
    if (!bar) return;
    const label = document.createElement("span");
    label.className = "preset-label"; label.textContent = "Load a song";
    bar.appendChild(label);
    PRESETS.forEach((p) => {
      const b = document.createElement("button");
      b.className = "preset-btn";
      b.innerHTML = `<span class="pb-name">${p.name}</span><span class="pb-tag">${p.tag}</span>`;
      b.onclick = () => {
        applyPreset(p);
        bar.querySelectorAll(".preset-btn").forEach((x) => x.classList.remove("active"));
        b.classList.add("active");
      };
      bar.appendChild(b);
    });
  })();

  /* ============================== INIT ================================ */
  tempo.value = song.bpm; tempoVal.textContent = song.bpm;
  volVal.textContent = volume.value;
  buildRuler();
  buildLanes();
  buildGutter();
  updatePlayhead();
  requestAnimationFrame(frame);
})();
