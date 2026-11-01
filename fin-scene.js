/* KP Strategy 360° : scène animée « monde de l'ingénierie financière »
   Globe 3D dessiné en canvas (sans bibliothèque externe) :
   - flux de financement entre places financières (Douala au centre du réseau),
   - jetons LC / SBLC / EPC / FCFA / devises qui voyagent sur les liaisons,
   - pièces en orbite, courbe de marché et chandeliers en arrière-plan.
   Inclut aussi les effets 3D de l'interface (inclinaison des cartes, origine des transitions morph). */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  // Zones de terre stylisées : [latitude centre, longitude centre, rayon lat, rayon lon]
  const LAND = [[2, 17, 36, 36], [52, 15, 17, 28], [38, 95, 32, 50], [22, 78, 15, 12], [5, 105, 12, 14], [45, -100, 28, 38], [15, -90, 10, 12], [-15, -60, 38, 20], [-25, 134, 14, 22]];
  const HUBS = [
    { n: 'Douala · KP Strategy', lat: 4.05, lon: 9.7 }, { n: 'Paris', lat: 48.9, lon: 2.3 }, { n: 'Londres', lat: 51.5, lon: -0.1 },
    { n: 'New York', lat: 40.7, lon: -74 }, { n: 'Dubaï', lat: 25.2, lon: 55.3 }, { n: 'Shanghai', lat: 31.2, lon: 121.5 },
    { n: 'Johannesburg', lat: -26.2, lon: 28 }, { n: 'Lagos', lat: 6.5, lon: 3.4 }, { n: 'Mumbai', lat: 19, lon: 72.8 }, { n: 'São Paulo', lat: -23.5, lon: -46.6 }
  ];
  const TOKENS = ['LC', 'SBLC', 'EPC', 'FCFA', '€', '$', 'CIF', 'GARANTIE'];
  const COINS = ['$', '€', 'F'];

  const ll = (lat, lon) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; };
  const inLand = (lat, lon) => LAND.some(([la, lo, rla, rlo]) => { const dl = Math.abs(lon - lo), d = Math.min(dl, 360 - dl); return ((lat - la) / rla) ** 2 + (d / rlo) ** 2 <= 1; });
  const rotv = (v, ry, rx) => {
    let x = v[0], y = v[1], z = v[2];
    let c = Math.cos(ry), s = Math.sin(ry); const x1 = x * c + z * s, z1 = -x * s + z * c;
    c = Math.cos(rx); s = Math.sin(rx);
    return [x1, y * c - z1 * s, y * s + z1 * c];
  };

  class FinScene {
    constructor(canvas, opts) {
      this.cv = canvas; this.ctx = canvas.getContext('2d'); this.layout = (opts && opts.layout) || 'login';
      this.mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || innerWidth < 700;
      this.reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
      this.t = 0; this.last = 0; this.running = false; this.stopped = false; this.visible = true;
      this.px = 0; this.py = 0; this.tx = 0; this.ty = 0; this.w = 0; this.h = 0; this.mt = 0;
      this.buildGlobe(); this.buildArcs(); this.buildMarket(); this.buildDust();
      if ('ResizeObserver' in window) new ResizeObserver(() => this.resize()).observe(canvas);
      else addEventListener('resize', () => this.resize());
      addEventListener('pointermove', e => { this.tx = e.clientX / innerWidth - 0.5; this.ty = e.clientY / innerHeight - 0.5; }, { passive: true });
      if ('IntersectionObserver' in window) new IntersectionObserver(es => { this.visible = es[0].isIntersecting; this.kick(); }).observe(canvas);
      document.addEventListener('visibilitychange', () => this.kick());
      this.resize(); this.kick();
    }

    buildGlobe() {
      const n = this.mobile ? 1500 : 2800, ga = Math.PI * (3 - Math.sqrt(5));
      this.dots = [];
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), th = ga * i, x = Math.cos(th) * r, z = Math.sin(th) * r;
        if (inLand(Math.asin(y) * 180 / Math.PI, Math.atan2(x, z) * 180 / Math.PI)) this.dots.push([x, y, z]);
      }
    }

    buildArcs() {
      this.hubs = HUBS.map(h => Object.assign({ v: ll(h.lat, h.lon) }, h));
      const home = this.hubs[0], pairs = [];
      this.hubs.slice(1).forEach(h => pairs.push([home, h, 'home']));
      [[1, 3], [4, 5], [2, 8], [3, 9]].forEach(([a, b]) => pairs.push([this.hubs[a], this.hubs[b], 'cross']));
      this.arcs = pairs.map(([a, b, kind], k) => {
        const w = Math.acos(Math.max(-1, Math.min(1, a.v[0] * b.v[0] + a.v[1] * b.v[1] + a.v[2] * b.v[2]))), s = Math.sin(w) || 1;
        const hgt = 0.12 + 0.22 * (w / Math.PI), pts = [];
        for (let i = 0; i <= 40; i++) {
          const t = i / 40, k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s, e = 1 + hgt * Math.sin(Math.PI * t);
          pts.push([(a.v[0] * k1 + b.v[0] * k2) * e, (a.v[1] * k1 + b.v[1] * k2) * e, (a.v[2] * k1 + b.v[2] * k2) * e]);
        }
        return { pts, kind, token: TOKENS[k % TOKENS.length], phase: Math.random(), speed: 0.1 + Math.random() * 0.08 };
      });
    }

    nextCandle(p) {
      const o = p, c = Math.max(10, Math.min(90, o + (Math.random() - 0.46) * 9));
      return { o, c, h: Math.max(o, c) + Math.random() * 4, l: Math.min(o, c) - Math.random() * 4 };
    }
    buildMarket() {
      this.candles = []; let p = 50;
      for (let i = 0; i < (this.mobile ? 40 : 70); i++) { const c = this.nextCandle(p); this.candles.push(c); p = c.c; }
    }
    buildDust() { this.dust = Array.from({ length: this.mobile ? 24 : 60 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random(), s: 0.02 + Math.random() * 0.05 })); }

    resize() {
      const w = this.cv.clientWidth, h = this.cv.clientHeight;
      if (!w || !h) return;
      const dpr = this.dpr = Math.min(devicePixelRatio || 1, this.mobile ? 1.5 : 2);
      this.w = w; this.h = h; this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
      if (this.layout === 'login') {
        const wide = w >= 1000;
        this.cx = wide ? w * 0.68 : w * 0.5; this.cy = h * 0.5; this.R = Math.min(wide ? w * 0.27 : w * 0.45, h * 0.42);
      } else {
        this.cx = w >= 700 ? w * 0.76 : w * 0.5; this.cy = h * 0.52; this.R = Math.min(h * 0.42, w * 0.4);
      }
      if (this.reduce) this.frame(0);
    }

    kick() {
      if (this.reduce) { this.frame(0); return; }
      const should = this.visible && document.visibilityState === 'visible' && !this.stopped;
      if (should && !this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(ts => this.loop(ts)); }
    }
    stop() { this.stopped = true; this.running = false; }
    resume() { this.stopped = false; this.kick(); }
    loop(ts) {
      if (!this.running) return;
      if (!(this.visible && document.visibilityState === 'visible' && !this.stopped)) { this.running = false; return; }
      const dt = Math.min(0.05, (ts - this.last) / 1000); this.last = ts;
      this.frame(dt);
      requestAnimationFrame(t => this.loop(t));
    }

    frame(dt) {
      if (!this.w) { this.resize(); if (!this.w) return; }
      const ctx = this.ctx;
      this.t += dt;
      this.px += (this.tx - this.px) * 0.04; this.py += (this.ty - this.py) * 0.04;
      this.mt += dt;
      if (this.mt > 0.7) { this.mt = 0; this.candles.shift(); this.candles.push(this.nextCandle(this.candles[this.candles.length - 1].c)); }
      this.dust.forEach(d => { d.y -= d.s * dt * 0.5; if (d.y < -0.02) d.y = 1.02; });
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      this.drawMarket(ctx); this.drawDust(ctx); this.drawGlobe(ctx);
    }

    P(v) { const k = 1 / (1 - v[2] * 0.22); return [this.cx + v[0] * this.R * k, this.cy - v[1] * this.R * k, v[2], k]; }

    drawMarket(ctx) {
      const top = this.h * (this.layout === 'login' ? 0.66 : 0.5), H = this.h - top, n = this.candles.length, cw = this.w / n;
      const y = p => this.h - ((p - 5) / 90) * H * 0.95 - 4;
      this.candles.forEach((c, i) => {
        const x = i * cw + cw / 2, up = c.c >= c.o;
        ctx.strokeStyle = ctx.fillStyle = up ? 'rgba(46,213,115,0.32)' : 'rgba(255,71,87,0.28)';
        ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, y(c.h)); ctx.lineTo(x, y(c.l)); ctx.stroke();
        ctx.fillRect(x - cw * 0.3, Math.min(y(c.o), y(c.c)), cw * 0.6, Math.max(2, Math.abs(y(c.o) - y(c.c))));
      });
      ctx.beginPath();
      this.candles.forEach((c, i) => { const x = i * cw + cw / 2; if (i) ctx.lineTo(x, y(c.c)); else ctx.moveTo(x, y(c.c)); });
      ctx.strokeStyle = 'rgba(0,210,255,0.55)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.lineTo(this.w, this.h); ctx.lineTo(0, this.h); ctx.closePath();
      const g = ctx.createLinearGradient(0, top, 0, this.h);
      g.addColorStop(0, 'rgba(0,210,255,0.16)'); g.addColorStop(1, 'rgba(0,210,255,0)');
      ctx.fillStyle = g; ctx.fill();
    }

    drawDust(ctx) {
      this.dust.forEach(d => { ctx.fillStyle = 'rgba(242,201,76,' + (0.15 + 0.35 * d.z).toFixed(2) + ')'; ctx.fillRect(d.x * this.w, d.y * this.h, 1 + 2 * d.z, 1 + 2 * d.z); });
    }

    drawGlobe(ctx) {
      const R = this.R, cx = this.cx, cy = this.cy;
      const ry = -0.17 + this.t * 0.12 + this.px * 0.9, rx = 0.35 + this.py * 0.4;

      // sphère
      const g = ctx.createRadialGradient(cx - R * 0.3, cy - R * 0.3, R * 0.1, cx, cy, R * 1.05);
      g.addColorStop(0, 'rgba(0,210,255,0.16)'); g.addColorStop(0.7, 'rgba(6,24,48,0.55)'); g.addColorStop(1, 'rgba(0,210,255,0.05)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,210,255,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();

      // continents (points)
      const sz = this.mobile ? 1.5 : 1.8, front = [], back = [];
      for (const d of this.dots) { const v = rotv(d, ry, rx), p = this.P(v); (v[2] > 0 ? front : back).push(p); }
      ctx.fillStyle = 'rgba(0,210,255,0.14)'; ctx.beginPath(); back.forEach(p => ctx.rect(p[0], p[1], sz * p[3], sz * p[3])); ctx.fill();
      ctx.fillStyle = 'rgba(120,230,255,0.85)'; ctx.beginPath(); front.forEach(p => ctx.rect(p[0], p[1], sz * p[3], sz * p[3])); ctx.fill();

      // liaisons de financement + jetons
      ctx.lineWidth = 1.2;
      this.arcs.forEach(a => {
        const pr = a.pts.map(p => this.P(rotv(p, ry, rx)));
        ctx.strokeStyle = a.kind === 'home' ? 'rgba(0,210,255,0.45)' : 'rgba(242,201,76,0.38)';
        ctx.beginPath(); let pen = false;
        pr.forEach(p => { if (p[2] > -0.05) { if (pen) ctx.lineTo(p[0], p[1]); else { ctx.moveTo(p[0], p[1]); pen = true; } } else pen = false; });
        ctx.stroke();
        const f = (a.phase + this.t * a.speed) % 1, idx = Math.floor(f * 40), head = pr[idx];
        if (head && head[2] > 0) {
          for (let k = 0; k < 8 && idx - k >= 0; k++) {
            const q = pr[idx - k];
            ctx.fillStyle = (a.kind === 'home' ? 'rgba(0,210,255,' : 'rgba(242,201,76,') + (0.9 - k * 0.11).toFixed(2) + ')';
            ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(0.6, (3 - k * 0.3) * q[3]), 0, TAU); ctx.fill();
          }
          if (head[2] > 0.25 && !this.mobile) this.chip(ctx, head[0] + 8, head[1] - 10, a.token);
        }
      });

      // places financières
      this.hubs.forEach((h, i) => {
        const v = rotv(h.v, ry, rx), p = this.P(v);
        if (v[2] < 0.05) return;
        ctx.fillStyle = i === 0 ? '#f2c94c' : '#e2f8ff';
        ctx.beginPath(); ctx.arc(p[0], p[1], (i === 0 ? 4.5 : 2.6) * p[3], 0, TAU); ctx.fill();
        if (i === 0) {
          for (let k = 0; k < 2; k++) {
            const f = (this.t * 0.6 + k * 0.5) % 1;
            ctx.strokeStyle = 'rgba(242,201,76,' + (0.7 * (1 - f)).toFixed(2) + ')'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(p[0], p[1], (6 + f * 26) * p[3], 0, TAU); ctx.stroke();
          }
        }
        if (i === 0 || !this.mobile) {
          ctx.font = (i === 0 ? '700 12px' : '10px') + ' Arial, sans-serif';
          ctx.fillStyle = i === 0 ? '#f2c94c' : 'rgba(226,248,255,0.7)';
          ctx.fillText(h.n, p[0] + 8, p[1] + 4);
        }
      });

      // anneau orbital + pièces
      const ringV = a => rotv(rotv([Math.cos(a) * 1.38, 0, Math.sin(a) * 1.38], 0.3 + this.px * 0.5, 1.15 + this.py * 0.3), 0, 0);
      ctx.lineWidth = 1;
      let prev = null;
      for (let i = 0; i <= 90; i++) {
        const v = ringV(i / 90 * TAU), p = this.P(v), hidden = v[2] < 0 && Math.hypot(p[0] - cx, p[1] - cy) < R * 0.98;
        if (prev && !hidden && !prev.hidden) { ctx.strokeStyle = v[2] > 0 ? 'rgba(242,201,76,0.35)' : 'rgba(242,201,76,0.12)'; ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p[0], p[1]); ctx.stroke(); }
        prev = { x: p[0], y: p[1], hidden };
      }
      for (let i = 0; i < 3; i++) {
        const v = ringV(this.t * 0.45 + i * TAU / 3), p = this.P(v);
        if (v[2] < 0 && Math.hypot(p[0] - cx, p[1] - cy) < R * 0.98) continue;
        const r = 9 * p[3], cg = ctx.createRadialGradient(p[0] - r * 0.3, p[1] - r * 0.3, r * 0.1, p[0], p[1], r);
        cg.addColorStop(0, '#fff3b0'); cg.addColorStop(1, '#d4a017');
        ctx.fillStyle = cg; ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, TAU); ctx.fill();
        ctx.fillStyle = '#4a3600'; ctx.font = '700 ' + Math.round(r * 1.1) + 'px Arial, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(COINS[i], p[0], p[1] + 1); ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      }
    }

    chip(ctx, x, y, text) {
      ctx.font = '700 10px Arial, sans-serif';
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = 'rgba(5,12,24,0.8)'; ctx.strokeStyle = 'rgba(242,201,76,0.8)'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(x, y - 10, w, 16, 8); else ctx.rect(x, y - 10, w, 16);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f2c94c'; ctx.fillText(text, x + 6, y + 2);
    }
  }
  window.FinScene = FinScene;

  document.addEventListener('DOMContentLoaded', () => {
    // Scènes : écran d'accueil (connexion) et bandeau du tableau de bord
    const l = document.getElementById('fin-canvas-login');
    if (l) window.loginScene = new FinScene(l, { layout: 'login' });
    const hc = document.getElementById('fin-canvas-hero');
    if (hc) window.heroScene = new FinScene(hc, { layout: 'hero' });

    // Phrases qui se transforment (morph) en douceur
    const phrases = ['Financement de projets', 'Crédit documentaire & SBLC', 'Garanties bancaires', 'Structuration EPC', 'Zone CEMAC & international'];
    const els = Array.from(document.querySelectorAll('.morph-tagline'));
    let k = 0;
    els.forEach(el => { const s = document.createElement('span'); s.textContent = phrases[0]; el.appendChild(s); });
    setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      k = (k + 1) % phrases.length;
      els.forEach(el => { const s = el.firstElementChild; s.classList.add('out'); setTimeout(() => { s.textContent = phrases[k]; s.classList.remove('out'); }, 450); });
    }, 3200);

    // Inclinaison 3D des cartes (souris) + origine des transitions « morph » (clic / toucher)
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let cur = null;
    if (!reduce) {
      document.addEventListener('pointermove', e => {
        if (e.pointerType !== 'mouse') return;
        const el = e.target.closest ? e.target.closest('.stat-card, .chart-card, .login-box') : null;
        if (cur && cur !== el) { cur.style.setProperty('--rx', '0deg'); cur.style.setProperty('--ry', '0deg'); }
        cur = el;
        if (!el) return;
        const r = el.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        el.style.setProperty('--ry', (x * 12).toFixed(2) + 'deg');
        el.style.setProperty('--rx', (-y * 12).toFixed(2) + 'deg');
      }, { passive: true });
    }
    document.addEventListener('pointerdown', e => {
      const s = document.documentElement.style;
      s.setProperty('--mx', (e.clientX / innerWidth * 100).toFixed(1) + '%');
      s.setProperty('--my', (e.clientY / innerHeight * 100).toFixed(1) + '%');
    }, { passive: true });
  });
})();
