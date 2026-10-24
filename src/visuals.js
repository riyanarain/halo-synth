const BONES = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
];
const TIPS = [4, 8, 12, 16, 20];
const MAX_PARTICLES = 1400;
const DEGREE_TOP = 0.85; // keep in sync with hand-height range in main.js
const DEGREE_SPAN = 0.6;

export class Visuals {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.video = video;
    this.showFeed = true;
    this.hasCamera = false;
    this.particles = [];
    this.layerPulse = [];
    this.buf = new Uint8Array(512);
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.W = innerWidth;
    this.H = innerHeight;
    this.canvas.width = this.W * dpr;
    this.canvas.height = this.H * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.g.fillStyle = '#06060e';
    this.g.fillRect(0, 0, this.W, this.H);
  }

  // "cover" fit of the video into the canvas.
  frame() {
    const vw = this.video.videoWidth || 16;
    const vh = this.video.videoHeight || 9;
    const s = Math.max(this.W / vw, this.H / vh);
    const dw = vw * s;
    const dh = vh * s;
    return { dw, dh, ox: (this.W - dw) / 2, oy: (this.H - dh) / 2 };
  }

  map(p) {
    const f = this.frame();
    return [f.ox + p.x * f.dw, f.oy + p.y * f.dh];
  }

  burst(p, hue, strength = 0.8) {
    const [x, y] = this.map(p);
    this.burstAt(x, y, hue, strength);
  }

  burstAt(x, y, hue, strength = 0.8) {
    const n = Math.round(14 + strength * 22);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (40 + Math.random() * 220) * (0.5 + strength);
      this.spawn(x, y, Math.cos(a) * sp, Math.sin(a) * sp, hue + (Math.random() - 0.5) * 30, 0.7 + Math.random() * 0.8, 2 + Math.random() * 3);
    }
  }

  pulseLayer(i) {
    this.layerPulse[i] = 1;
  }

  spawn(x, y, vx, vy, hue, life, size) {
    if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
    this.particles.push({ x, y, vx, vy, hue, life, max: life, size });
  }

  // s: { L, R, held:[{p,hue}], pinch:[{from,to}], analyser, padLevel, degree, chord, hue, looper }
  draw(s, dt) {
    const g = this.g;
    const { W, H } = this;

    g.globalCompositeOperation = 'source-over';
    g.fillStyle = 'rgba(6,6,14,0.2)';
    g.fillRect(0, 0, W, H);

    if (this.showFeed && this.hasCamera && this.video.readyState >= 2) {
      const f = this.frame();
      g.save();
      g.globalAlpha = 0.1;
      g.translate(W, 0);
      g.scale(-1, 1);
      g.drawImage(this.video, f.ox, f.oy, f.dw, f.dh);
      g.restore();
    }

    g.globalCompositeOperation = 'lighter';

    const rms = this.drawCore(s);
    this.drawLoop(s, rms, dt);
    this.drawGuide(s);

    if (s.L) this.drawHand(s.L, 195, s);
    if (s.R) this.drawHand(s.R, 320, s);

    // Held notes leave a trail; the pad hand breathes particles upward.
    for (const h of s.held) {
      const [x, y] = this.map(h.p);
      for (let i = 0; i < 2; i++) {
        this.spawn(x, y, (Math.random() - 0.5) * 60, (Math.random() - 0.5) * 60, h.hue, 0.6 + Math.random() * 0.6, 2 + Math.random() * 3);
      }
    }
    if (s.L && s.padLevel > 0.05 && Math.random() < s.padLevel * 1.5) {
      const [x, y] = this.map(s.L[9]);
      this.spawn(x + (Math.random() - 0.5) * 80, y, (Math.random() - 0.5) * 30, -40 - Math.random() * 60, s.hue, 1.4, 3 + Math.random() * 4);
    }

    this.drawParticles(dt);
  }

  drawCore(s) {
    const g = this.g;
    const { W, H } = this;
    let rms = 0;
    const R0 = Math.min(W, H) * 0.13;
    if (s.analyser) {
      s.analyser.getByteTimeDomainData(this.buf);
      for (const v of this.buf) rms += ((v - 128) / 128) ** 2;
      rms = Math.sqrt(rms / this.buf.length);
    }
    this.rms = (this.rms || 0) * 0.85 + rms * 0.15;
    const r = R0 * (1 + this.rms * 1.6);
    const N = 256;
    const path = () => {
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        const v = ((this.buf[i % N * 2] - 128) / 128) * r * 0.7;
        const x = W / 2 + Math.cos(a) * (r + v);
        const y = H / 2 + Math.sin(a) * (r + v);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath();
    };
    path();
    g.strokeStyle = `hsla(${s.hue},90%,60%,0.12)`;
    g.lineWidth = 12;
    g.stroke();
    path();
    g.strokeStyle = `hsla(${s.hue},90%,70%,0.6)`;
    g.lineWidth = 1.6;
    g.stroke();
    this.R0 = R0;
    return this.rms;
  }

  drawLoop(s, rms, dt) {
    const g = this.g;
    const { W, H } = this;
    const lp = s.looper;
    const cx = W / 2;
    const cy = H / 2;
    const base = this.R0 * 1.8;

    if (lp.state === 'recording' || lp.state === 'overdub') {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 160);
      g.beginPath();
      g.arc(cx, cy, base - 14, 0, Math.PI * 2);
      g.strokeStyle = `hsla(0,90%,60%,${0.25 + pulse * 0.5})`;
      g.lineWidth = 3;
      g.stroke();
    }

    lp.layers.forEach((layer, i) => {
      const r = base + i * 16;
      const pulse = (this.layerPulse[i] = (this.layerPulse[i] || 0) * Math.pow(0.04, dt));
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.strokeStyle = `hsla(${layer.hue},80%,60%,${0.14 + pulse * 0.5})`;
      g.lineWidth = 1.5 + pulse * 3;
      g.stroke();
      for (const ev of layer.events) {
        const a = -Math.PI / 2 + (ev.t / lp.length) * Math.PI * 2;
        g.beginPath();
        g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
        g.fillStyle = `hsla(${(ev.midi % 12) * 30},90%,65%,0.8)`;
        g.fill();
      }
    });

    if (lp.layers.length && (lp.state === 'playing' || lp.state === 'overdub')) {
      const a = -Math.PI / 2 + lp.phase() * Math.PI * 2;
      const r = base + (lp.layers.length - 1) * 16;
      g.beginPath();
      g.moveTo(cx + Math.cos(a) * (base - 8), cy + Math.sin(a) * (base - 8));
      g.lineTo(cx + Math.cos(a) * (r + 8), cy + Math.sin(a) * (r + 8));
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.lineWidth = 1.5;
      g.stroke();
    }
  }

  // Left-edge ruler showing which chord the left hand's height selects.
  drawGuide(s) {
    const g = this.g;
    g.font = '600 12px ui-monospace, Menlo, monospace';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    for (let k = 0; k < 7; k++) {
      const [, y] = this.map({ x: 0, y: DEGREE_TOP - ((k + 0.5) / 7) * DEGREE_SPAN });
      const on = k === s.degree;
      g.fillStyle = on ? `hsla(${s.hue},95%,70%,0.95)` : 'rgba(255,255,255,0.22)';
      g.fillRect(18, y - 1, on ? 26 : 12, 2);
      g.fillText(on ? s.chord : String(k + 1), 52, y);
    }
  }

  drawHand(pts, hue, s) {
    const g = this.g;
    const P = pts.map((p) => this.map(p));
    g.lineCap = 'round';
    for (const [w, a] of [[8, 0.1], [1.8, 0.85]]) {
      g.strokeStyle = `hsla(${hue},95%,68%,${a})`;
      g.lineWidth = w;
      g.beginPath();
      for (const [a0, b0] of BONES) {
        g.moveTo(P[a0][0], P[a0][1]);
        g.lineTo(P[b0][0], P[b0][1]);
      }
      g.stroke();
    }
    for (const i of TIPS) {
      const [x, y] = P[i];
      const grad = g.createRadialGradient(x, y, 0, x, y, 16);
      grad.addColorStop(0, `hsla(${hue},100%,80%,0.9)`);
      grad.addColorStop(1, `hsla(${hue},100%,60%,0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, 16, 0, Math.PI * 2);
      g.fill();
    }
    for (const pin of s.pinch) {
      if (pin.pts !== pts) continue;
      const [x0, y0] = P[4];
      const [x1, y1] = P[pin.tip];
      g.strokeStyle = `hsla(${pin.hue},100%,75%,0.95)`;
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      const grad = g.createRadialGradient(x1, y1, 0, x1, y1, 34);
      grad.addColorStop(0, `hsla(${pin.hue},100%,75%,0.9)`);
      grad.addColorStop(1, `hsla(${pin.hue},100%,55%,0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x1, y1, 34, 0, Math.PI * 2);
      g.fill();
    }
  }

  drawParticles(dt) {
    const g = this.g;
    const keep = [];
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.pow(0.12, dt);
      p.vx *= drag;
      p.vy *= drag;
      const t = p.life / p.max;
      g.fillStyle = `hsla(${p.hue},95%,65%,${t * 0.8})`;
      g.beginPath();
      g.arc(p.x, p.y, p.size * (0.4 + t * 0.6), 0, Math.PI * 2);
      g.fill();
      keep.push(p);
    }
    this.particles = keep;
  }
}
