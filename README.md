# HALO — gesture light synth

Play a synth, a pad and a looper with your bare hands, in the browser. Inspired by Imogen Heap's Mi.Mu gloves. Hand tracking runs locally in your browser with MediaPipe; no video or audio leaves your machine.

## Run it

No build step. Camera access needs `localhost` or HTTPS.

```bash
python3 -m http.server 8000
# open http://localhost:8000 in Chrome or Edge
```

## Playing

| Hand | Gesture | Effect |
|---|---|---|
| Left | Height | Picks the chord (ruler on the left edge) |
| Left | Open / close | Pad level and brightness |
| Left | Tilt right / left | Adds a 7th / sus2 |
| Left | Hold a fist ~0.7s | Start / stop the loop, then overdub |
| Right | Pinch thumb to index, middle, ring, pinky | Plays a note; faster pinch = louder |
| Right | Height | Octave |
| Right | Tilt | Filter brightness |
| Right | Move right | More echo and reverb |

Keyboard fallback: `A S D F` notes, `1`–`7` chord, `↑↓` octave, `Space` loop/overdub, `Z` undo layer, `Backspace` clear, `M` finger mode, `V` camera feed, `H` help.

## How it works

- `src/tracking.js` — MediaPipe HandLandmarker, mirrored, with a One Euro filter (`src/filter.js`) on every landmark to remove jitter without adding lag.
- `src/audio.js` — Web Audio: detuned-saw pad, three-oscillator voices, dotted-eighth delay, convolution reverb.
- `src/looper.js` — records note events (not audio), schedules them on the audio clock, up to 6 layers.
- `src/visuals.js` — canvas renderer: glowing skeletons, particles, audio-reactive core ring, one ring per loop layer.
- `src/theory.js` — scales and chord building.

## Ideas

Mic sampling and granular playback, Web MIDI out, per-gesture mapping editor, WebGL shaders.
