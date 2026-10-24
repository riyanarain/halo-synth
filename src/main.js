import { Engine } from './audio.js';
import { Looper } from './looper.js';
import { Visuals } from './visuals.js';
import { createTracker } from './tracking.js';
import { NOTE_NAMES, SCALES, chordFor, chordName, scaleSemi } from './theory.js';

const $ = (s) => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

const video = $('#cam');
const engine = new Engine();
const visuals = new Visuals($('#stage'), video);
let looper = null;
let tracker = null;

const S = {
  key: 9, // A
  scaleName: 'Minor',
  mode: 'chord', // right-hand fingers play chord tones or stepwise scale notes
  degree: 0,
  seventh: false,
  sus2: false,
  kbOctave: 0,
  padLevel: 0,
  chord: 'Am',
};

// Hand height -> chord degree. Keep in sync with DEGREE_* in visuals.js.
const DEG_TOP = 0.85;
const DEG_SPAN = 0.6;
const FINGER_TIPS = [8, 12, 16, 20];
const hueOf = (midi) => (midi % 12) * 30;

const held = new Map();
const pinchState = FINGER_TIPS.map(() => ({ on: false, prev: 1, rate: 0 }));
let fistTime = 0;
let fistLatched = false;

// ---------- music ----------
const scale = () => SCALES[S.scaleName];

function applyChord() {
  const opts = { seventh: S.seventh, sus2: S.sus2 };
  engine.setChord(chordFor(scale(), S.degree, opts).map((s) => 48 + S.key + s));
  S.chord = chordName(scale(), S.key, S.degree, opts);
  $('#chord').textContent = S.chord;
}

function noteOn(id, midi, vel, bright, send, tip) {
  if (held.has(id)) return;
  const voice = engine.noteOn({ midi, vel, bright, send });
  held.set(id, { voice, midi, vel, bright, send, tip, start: engine.ctx.currentTime });
  visuals.burst(tip, hueOf(midi), vel);
}

function noteOff(id) {
  const n = held.get(id);
  if (!n) return;
  n.voice.release();
  held.delete(id);
  looper.record({
    start: n.start,
    dur: engine.ctx.currentTime - n.start + 0.05,
    midi: n.midi,
    vel: n.vel,
    bright: n.bright,
    send: n.send,
  });
}

function onLoopNote(ev, layer, when) {
  const delay = Math.max(0, (when - engine.ctx.currentTime) * 1000);
  setTimeout(() => {
    visuals.pulseLayer(layer);
    const lp = looper;
    const a = -Math.PI / 2 + (ev.t / lp.length) * Math.PI * 2;
    const r = visuals.R0 * 1.8 + layer * 16;
    visuals.burstAt(visuals.W / 2 + Math.cos(a) * r, visuals.H / 2 + Math.sin(a) * r, hueOf(ev.midi), ev.vel * 0.6);
  }, delay);
}

// ---------- hand features ----------
function features(pts, aspect) {
  const d = (a, b) => Math.hypot((pts[a].x - pts[b].x) * aspect, pts[a].y - pts[b].y);
  const palm = d(0, 9) || 1e-3;
  const open = clamp((FINGER_TIPS.reduce((s, t) => s + d(t, 0), 0) / 4 / palm - 1.2) / 0.6);
  return {
    palm,
    open,
    cx: pts[9].x,
    cy: pts[9].y,
    roll: Math.atan2((pts[9].x - pts[0].x) * aspect, -(pts[9].y - pts[0].y)),
    pinch: FINGER_TIPS.map((t) => d(4, t) / palm),
  };
}

function updateLeft(pts, aspect, dt) {
  if (!pts) {
    S.padLevel = 0;
    fistTime = 0;
    fistLatched = false;
    return;
  }
  const f = features(pts, aspect);

  const v = clamp((DEG_TOP - f.cy) / DEG_SPAN, 0, 0.999) * 7;
  const nd = Math.floor(v);
  let changed = false;
  if (nd !== S.degree && Math.abs(v - (S.degree + 0.5)) > 0.65) {
    S.degree = nd;
    changed = true;
  }
  const seventh = S.seventh ? f.roll > 0.15 : f.roll > 0.35;
  const sus2 = S.sus2 ? f.roll < -0.15 : f.roll < -0.35;
  if (seventh !== S.seventh || sus2 !== S.sus2) {
    S.seventh = seventh;
    S.sus2 = sus2;
    changed = true;
  }
  if (changed) applyChord();

  S.padLevel = f.open < 0.1 ? 0 : 0.3 + 0.7 * f.open;
  engine.setPad(S.padLevel, 250 + f.open * f.open * 3800);

  // Hold a fist for ~0.7s to start / stop the loop.
  if (f.open < 0.1) {
    fistTime += dt;
    if (fistTime > 0.7 && !fistLatched) {
      fistLatched = true;
      toggleLoop();
    }
  } else {
    fistTime = 0;
    fistLatched = false;
  }
}

function updateRight(pts, aspect, dt, pinches) {
  if (!pts) {
    for (const id of [...held.keys()]) if (id.startsWith('h')) noteOff(id);
    pinchState.forEach((p) => (p.on = false));
    return;
  }
  const f = features(pts, aspect);
  const sc = scale();
  const oct = f.cy < 0.33 ? 1 : f.cy < 0.66 ? 0 : -1;
  const stepBase = Math.round(clamp((DEG_TOP - f.cy) / DEG_SPAN) * 9) - 2;
  const bright = clamp(0.5 + f.roll / 1.2, 0.05, 1);
  const send = 0.1 + clamp((f.cx - 0.35) / 0.6) * 0.65;

  FINGER_TIPS.forEach((tip, i) => {
    const st = pinchState[i];
    const ratio = f.pinch[i];
    st.rate = Math.max(st.rate * Math.pow(0.02, dt), (st.prev - ratio) / Math.max(dt, 1e-3));
    st.prev = ratio;
    const id = 'h' + i;

    if (!st.on && ratio < 0.3 && f.open > 0.2) {
      st.on = true;
      const vel = clamp(0.4 + st.rate / 12, 0.4, 1);
      const idx = S.mode === 'chord' ? S.degree + [0, 2, 4, 6][i] : stepBase + i;
      const midi = 60 + S.key + scaleSemi(sc, idx) + (S.mode === 'chord' ? 12 * oct : 0);
      noteOn(id, midi, vel, bright, send, pts[tip]);
    } else if (st.on && ratio > 0.5) {
      st.on = false;
      noteOff(id);
    }

    const n = held.get(id);
    if (n) {
      n.voice.setBright(bright);
      n.tip = pts[tip];
      pinches.push({ pts, tip, hue: hueOf(n.midi) });
    }
  });
}

// ---------- looper ----------
function toggleLoop() {
  if (looper) looper.toggle();
}

function updateHud() {
  const lp = looper;
  const label = {
    idle: '',
    recording: `● REC ${lp.elapsed().toFixed(1)}s`,
    playing: `▶ LOOP · ${lp.layers.length} layer${lp.layers.length === 1 ? '' : 's'}`,
    overdub: '● OVERDUB',
  }[lp.state];
  const el = $('#loop');
  if (el.textContent !== label) el.textContent = label;
  el.dataset.state = lp.state;
}

// ---------- frame loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;

  const hands = tracker ? tracker.detect(now) : { L: null, R: null };
  const aspect = (video.videoWidth || 16) / (video.videoHeight || 9);
  const pinches = [];

  if (tracker) {
    updateLeft(hands.L, aspect, dt);
    updateRight(hands.R, aspect, dt, pinches);
  } else {
    S.padLevel = 0.6;
    engine.setPad(0.6, 1400);
  }

  const heldTips = [...held.values()].map((n) => ({ p: n.tip, hue: hueOf(n.midi) }));
  visuals.draw(
    {
      L: hands.L,
      R: hands.R,
      held: heldTips,
      pinch: pinches,
      analyser: engine.analyser,
      padLevel: S.padLevel,
      degree: S.degree,
      chord: S.chord,
      hue: (S.degree * 47 + 200) % 360,
      looper,
    },
    dt,
  );
  updateHud();
  requestAnimationFrame(frame);
}

// ---------- UI ----------
function fillSelect(sel, items, value, onChange) {
  items.forEach(([label, v]) => sel.append(new Option(label, v)));
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
}

function setupUi() {
  fillSelect($('#key'), NOTE_NAMES.map((n, i) => [n, i]), S.key, (v) => {
    S.key = +v;
    applyChord();
  });
  fillSelect($('#scale'), Object.keys(SCALES).map((n) => [n, n]), S.scaleName, (v) => {
    S.scaleName = v;
    applyChord();
  });
  const modeBtn = $('#mode');
  const toggleMode = () => {
    S.mode = S.mode === 'chord' ? 'scale' : 'chord';
    modeBtn.textContent = `Fingers: ${S.mode === 'chord' ? 'chord tones' : 'scale steps'}`;
  };
  modeBtn.onclick = toggleMode;
  const feedBtn = $('#feed');
  const toggleFeed = () => {
    visuals.showFeed = !visuals.showFeed;
    feedBtn.classList.toggle('off', !visuals.showFeed);
  };
  feedBtn.onclick = toggleFeed;
  $('#rec').onclick = toggleLoop;
  $('#undo').onclick = () => looper.undo();
  $('#clear').onclick = () => looper.clear();
  const help = $('#help');
  const toggleHelp = () => help.classList.toggle('hidden');
  $('#helpBtn').onclick = toggleHelp;

  const KEYS = 'asdf';
  addEventListener('keydown', (e) => {
    if (e.repeat || e.target.tagName === 'SELECT' || !looper) return;
    const k = e.key.toLowerCase();
    const i = KEYS.indexOf(k);
    if (i >= 0) {
      const idx = S.mode === 'chord' ? S.degree + [0, 2, 4, 6][i] : S.degree + i;
      const midi = 60 + S.key + scaleSemi(scale(), idx) + 12 * S.kbOctave;
      noteOn('k' + i, midi, 0.8, 0.6, 0.3, { x: 0.45 + i * 0.07, y: 0.55 });
    } else if (k >= '1' && k <= '7') {
      S.degree = +k - 1;
      applyChord();
    } else if (k === ' ') {
      e.preventDefault();
      toggleLoop();
    } else if (k === 'backspace') looper.clear();
    else if (k === 'z') looper.undo();
    else if (k === 'm') toggleMode();
    else if (k === 'v') toggleFeed();
    else if (k === 'h') toggleHelp();
    else if (k === 'arrowup') S.kbOctave = Math.min(2, S.kbOctave + 1);
    else if (k === 'arrowdown') S.kbOctave = Math.max(-2, S.kbOctave - 1);
  });
  addEventListener('keyup', (e) => {
    const i = KEYS.indexOf(e.key.toLowerCase());
    if (i >= 0 && looper) noteOff('k' + i);
  });
}

async function start(useCamera) {
  const status = $('#status');
  $('#startCam').disabled = $('#startKb').disabled = true;
  try {
    await engine.start();
  } catch (e) {
    status.textContent = 'Could not start audio: ' + e.message;
    return;
  }
  looper = new Looper(engine, onLoopNote);
  setupUi();
  applyChord();

  if (useCamera) {
    try {
      tracker = await createTracker(video, (m) => (status.textContent = m));
      visuals.hasCamera = true;
    } catch (e) {
      console.error(e);
      tracker = null;
      status.textContent = `Camera / hand tracking unavailable (${e.message || e.name}). Using keyboard.`;
      await new Promise((r) => setTimeout(r, 1800));
    }
  }
  $('#intro').classList.add('hidden');
  $('#hud').classList.remove('hidden');
  if (!tracker) $('#help').classList.remove('hidden');
  requestAnimationFrame(frame);
}

$('#startCam').onclick = () => start(true);
$('#startKb').onclick = () => start(false);
