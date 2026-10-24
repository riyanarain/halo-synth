import { mtof } from './theory.js';

function makeImpulse(ctx, seconds = 3, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}

export class Engine {
  start() {
    // Created synchronously so it counts as part of the user's click.
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.build();
    return c.resume();
  }

  build() {
    const c = this.ctx;

    this.master = c.createGain();
    this.master.gain.value = 0.85;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.analyser = c.createAnalyser();
    this.analyser.fftSize = 1024;
    this.master.connect(comp).connect(this.analyser).connect(c.destination);

    this.voiceBus = c.createGain();
    this.voiceBus.connect(this.master);

    // Dotted-eighth feedback delay at 120bpm.
    this.delaySend = c.createGain();
    const delay = c.createDelay(2);
    delay.delayTime.value = 0.375;
    const fb = c.createGain();
    fb.gain.value = 0.45;
    const dlp = c.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2600;
    this.delaySend.connect(delay).connect(dlp).connect(fb).connect(delay);
    dlp.connect(this.master);

    this.reverbSend = c.createGain();
    const conv = c.createConvolver();
    conv.buffer = makeImpulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.9;
    this.reverbSend.connect(conv).connect(wet).connect(this.master);

    // Pad: four voices, each two detuned saws.
    this.padFilter = c.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.Q.value = 3;
    this.padFilter.frequency.value = 800;
    this.padGain = c.createGain();
    this.padGain.gain.value = 0;
    const padRev = c.createGain();
    padRev.gain.value = 0.55;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.master);
    this.padGain.connect(padRev).connect(this.reverbSend);

    this.padOscs = [];
    for (let i = 0; i < 4; i++) {
      for (const det of [-9, 9]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 220;
        o.detune.value = det;
        const g = c.createGain();
        g.gain.value = 0.11;
        o.connect(g).connect(this.padFilter);
        o.start();
        this.padOscs.push(o);
      }
    }
  }

  setChord(midis) {
    const t = this.ctx.currentTime;
    midis.forEach((m, i) => {
      const f = mtof(m);
      this.padOscs[i * 2].frequency.setTargetAtTime(f, t, 0.07);
      this.padOscs[i * 2 + 1].frequency.setTargetAtTime(f, t, 0.07);
    });
  }

  setPad(level, cutoff) {
    const t = this.ctx.currentTime;
    this.padGain.gain.setTargetAtTime(level * 0.5, t, 0.12);
    this.padFilter.frequency.setTargetAtTime(cutoff, t, 0.06);
  }

  // Sustains until voice.release(when). `when` lets the looper schedule on the audio clock.
  noteOn({ midi, vel = 0.8, bright = 0.6, send = 0.2 }, when = this.ctx.currentTime) {
    const c = this.ctx;
    const f = mtof(midi);
    const cutoffFor = (b) => 500 + b * 4500;

    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 4;
    const base = cutoffFor(bright);
    filter.frequency.setValueAtTime(Math.min(base * (1 + vel * 3), 14000), when);
    filter.frequency.exponentialRampToValueAtTime(base, when + 0.3);

    const amp = c.createGain();
    amp.gain.setValueAtTime(0, when);
    amp.gain.linearRampToValueAtTime(vel * 0.36, when + 0.006);
    amp.gain.setTargetAtTime(vel * 0.2, when + 0.01, 0.3);

    const oscs = [
      ['sawtooth', f, -6, 0.34],
      ['triangle', f, 7, 0.32],
      ['sine', f / 2, 0, 0.3],
    ].map(([type, freq, detune, level]) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      o.detune.value = detune;
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(when);
      return o;
    });

    filter.connect(amp);
    amp.connect(this.voiceBus);
    const ds = c.createGain();
    ds.gain.value = send;
    const rs = c.createGain();
    rs.gain.value = 0.3 + send * 0.4;
    amp.connect(ds).connect(this.delaySend);
    amp.connect(rs).connect(this.reverbSend);

    let released = false;
    return {
      setBright: (b) => filter.frequency.setTargetAtTime(cutoffFor(b), c.currentTime, 0.05),
      release: (at = c.currentTime) => {
        if (released) return;
        released = true;
        amp.gain.setTargetAtTime(0, at, 0.09);
        oscs.forEach((o) => o.stop(at + 0.7));
        oscs[0].onended = () => {
          amp.disconnect();
          ds.disconnect();
          rs.disconnect();
        };
      },
    };
  }
}
