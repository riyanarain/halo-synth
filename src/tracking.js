import { OneEuro } from './filter.js';

const VISION = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';
const COAST_MS = 250; // keep the last pose this long after the hand drops out

function makeSlot() {
  return {
    filters: Array.from({ length: 42 }, () => new OneEuro()),
    pts: null,
    lastSeen: -1e9,
  };
}

// Returns { L, R, video }. L/R are 21 smoothed landmarks (x mirrored so it matches the
// selfie view on screen) or null. "L" is whichever hand is on the left of the screen.
export async function createTracker(video, onStatus = () => {}) {
  onStatus('Loading hand model…');
  const { HandLandmarker, FilesetResolver } = await import(`${VISION}/vision_bundle.mjs`);
  const fileset = await FilesetResolver.forVisionTasks(`${VISION}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let landmarker;
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }

  onStatus('Waiting for camera…');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 1280, height: 720, facingMode: 'user' },
    audio: false,
  });
  video.srcObject = stream;
  await video.play();

  const slots = { L: makeSlot(), R: makeSlot() };
  let lastVideoTime = -1;

  function smooth(slot, raw, now) {
    const t = now / 1000;
    slot.pts = raw.map((p, i) => ({
      x: slot.filters[i * 2].filter(p.x, t),
      y: slot.filters[i * 2 + 1].filter(p.y, t),
    }));
    slot.lastSeen = now;
  }

  function assign(hands, now) {
    if (hands.length >= 2) return { L: hands[0], R: hands[1] };
    if (hands.length === 0) return {};
    const h = hands[0];
    // A lone hand keeps the slot it was last in, so it doesn't flip when crossing centre.
    const dist = (slot) =>
      slot.pts && now - slot.lastSeen < 400
        ? Math.hypot(slot.pts[0].x - h[0].x, slot.pts[0].y - h[0].y)
        : Infinity;
    const dl = dist(slots.L);
    const dr = dist(slots.R);
    if (dl === Infinity && dr === Infinity) return h[0].x < 0.5 ? { L: h } : { R: h };
    return dl <= dr ? { L: h } : { R: h };
  }

  function detect(now) {
    if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const res = landmarker.detectForVideo(video, now);
      const hands = res.landmarks
        .map((lm) => lm.map((p) => ({ x: 1 - p.x, y: p.y })))
        .sort((a, b) => a[0].x - b[0].x);
      const raw = assign(hands, now);
      for (const k of ['L', 'R']) {
        const slot = slots[k];
        if (raw[k]) smooth(slot, raw[k], now);
        else if (now - slot.lastSeen > COAST_MS && slot.pts) {
          slot.pts = null;
          slot.filters.forEach((f) => f.reset());
        }
      }
    }
    return { L: slots.L.pts, R: slots.R.pts };
  }

  return {
    detect,
    stop() {
      stream.getTracks().forEach((t) => t.stop());
      landmarker.close();
    },
  };
}
