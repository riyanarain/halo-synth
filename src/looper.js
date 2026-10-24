const LOOKAHEAD = 0.15;
const MAX_LAYERS = 6;

// Records note events (not audio), so every layer stays editable and plays through the synth.
// idle -> recording -> playing <-> overdub
export class Looper {
  constructor(engine, onPlay) {
    this.engine = engine;
    this.onPlay = onPlay;
    this.layers = [];
    this.state = 'idle';
    this.length = 0;
    this.pending = [];
    setInterval(() => this.tick(), 25);
  }

  get now() {
    return this.engine.ctx.currentTime;
  }

  phase() {
    if (!this.length || this.state === 'idle' || this.state === 'recording') return 0;
    return (((this.now - this.loopStart) % this.length) + this.length) % this.length / this.length;
  }

  elapsed() {
    return this.state === 'recording' ? this.now - this.recStart : 0;
  }

  toggle() {
    const t = this.now;
    switch (this.state) {
      case 'idle':
        this.state = 'recording';
        this.recStart = t;
        this.pending = [];
        break;
      case 'recording':
        if (t - this.recStart < 0.5) {
          this.state = 'idle';
          break;
        }
        this.length = t - this.recStart;
        this.commit();
        this.loopStart = t;
        this.scheduledUntil = t;
        this.state = 'playing';
        break;
      case 'playing':
        if (this.layers.length >= MAX_LAYERS) break;
        this.pending = [];
        this.state = 'overdub';
        break;
      case 'overdub':
        this.commit();
        this.state = 'playing';
        break;
    }
    return this.state;
  }

  commit() {
    if (this.pending.length) {
      this.layers.push({ events: this.pending, hue: (this.layers.length * 57 + 190) % 360 });
    }
    this.pending = [];
  }

  // ev.start is an absolute audio-clock time.
  record(ev) {
    if (this.state === 'recording') {
      if (ev.start < this.recStart) return;
      this.pending.push({ ...ev, t: ev.start - this.recStart });
    } else if (this.state === 'overdub') {
      const t = (((ev.start - this.loopStart) % this.length) + this.length) % this.length;
      this.pending.push({ ...ev, t });
    }
  }

  undo() {
    this.layers.pop();
    if (!this.layers.length) this.clear();
  }

  clear() {
    this.layers = [];
    this.pending = [];
    this.state = 'idle';
    this.length = 0;
  }

  tick() {
    if (!this.engine.ctx || (this.state !== 'playing' && this.state !== 'overdub')) return;
    const horizon = this.now + LOOKAHEAD;
    const k0 = Math.floor((this.scheduledUntil - this.loopStart) / this.length);
    const k1 = Math.floor((horizon - this.loopStart) / this.length);
    for (let k = k0; k <= k1; k++) {
      const cycle = this.loopStart + k * this.length;
      this.layers.forEach((layer, li) => {
        for (const ev of layer.events) {
          const at = cycle + ev.t;
          if (at < this.scheduledUntil || at >= horizon) continue;
          const voice = this.engine.noteOn(ev, at);
          voice.release(at + Math.max(ev.dur, 0.06));
          this.onPlay(ev, li, at);
        }
      });
    }
    this.scheduledUntil = horizon;
  }
}
