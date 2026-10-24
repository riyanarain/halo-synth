// One Euro filter: low jitter when the hand is still, low lag when it moves fast.
// https://gery.casiez.net/1euro/
const TWO_PI = Math.PI * 2;
const alpha = (cutoff, dt) => 1 / (1 + 1 / (TWO_PI * cutoff) / dt);

export class OneEuro {
  constructor(minCutoff = 1.5, beta = 10, dCutoff = 1) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.reset();
  }

  reset() {
    this.x = null;
    this.dx = 0;
    this.t = 0;
  }

  filter(v, t) {
    if (this.x === null) {
      this.x = v;
      this.t = t;
      return v;
    }
    const dt = Math.max(t - this.t, 1e-3);
    this.dx += alpha(this.dCutoff, dt) * ((v - this.x) / dt - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (v - this.x);
    this.t = t;
    return this.x;
  }
}
