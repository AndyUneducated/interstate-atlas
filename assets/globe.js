/* A dotted globe, turned to the region on screen.

   The land is a fixed set of points (globe-dots.js); this projects them
   orthographically onto a canvas and turns the sphere between the two regions
   the long way a reader would cross, over the Pacific. The atlas's own
   countries in the region it faces are lit; everything else is ground.

   Colours come from CSS custom properties on the canvas, so the globe follows
   the theme without being told. */

import { LAND } from './globe-dots.js';

const RAD = Math.PI / 180;
/** Where each region is seen from: the centre of the view, in degrees. */
export const FACING = { na: [-100, 40], ea: [110, 32] };
const LIT = { na: 1, ea: 2 };

const ease = (x) => 1 - (1 - x) ** 3;

export class Globe {
  constructor(canvas, { region = 'na', lit = region, dot = 1 } = {}) {
    this.canvas = canvas;
    this.dot = dot;
    this.lit = lit;
    [this.lon, this.lat] = FACING[region];
    this.raf = 0;
    this.draw();
  }

  /** Turn to a region, lighting it; instantly where motion is unwelcome. */
  turn(region, { lit = region, ms = 1100 } = {}) {
    this.lit = lit;
    const [lon, lat] = FACING[region];
    this.spin(lon, lat, ms);
  }

  /** Turn by an offset from where it faces now and back, as a nod to a hover. */
  nudge(deg) {
    const [lon, lat] = [this.lon, this.lat];
    this.spin(lon + deg, lat, 380, () => this.spin(lon, lat, 520));
  }

  spin(lon, lat, ms, then) {
    cancelAnimationFrame(this.raf);
    if (ms <= 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.lon = lon; this.lat = lat; this.draw(); then?.(); return;
    }
    // The short way round, which between the two regions is across the Pacific.
    const from = [this.lon, this.lat];
    const dLon = ((((lon - from[0]) % 360) + 540) % 360) - 180;
    const t0 = performance.now();
    const step = (now) => {
      const k = ease(Math.min(1, (now - t0) / ms));
      this.lon = from[0] + dLon * k;
      this.lat = from[1] + (lat - from[1]) * k;
      this.draw();
      if (k < 1) this.raf = requestAnimationFrame(step);
      else then?.();
    };
    this.raf = requestAnimationFrame(step);
  }

  draw() {
    const c = this.canvas;
    const css = getComputedStyle(c);
    const size = c.clientWidth || parseFloat(css.width) || 26;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const px = Math.round(size * dpr);
    if (c.width !== px) { c.width = px; c.height = px; }
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size, size);

    const r = size / 2 - 0.75;
    const cx = size / 2;
    const cy = size / 2;
    const col = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    const sea = col('--g-sea', 'rgba(53,231,255,0.07)');
    const rim = col('--g-rim', 'rgba(53,231,255,0.35)');
    const land = col('--g-land', 'rgba(170,200,230,0.55)');
    const lit = col('--g-lit', '#35e7ff');

    const shade = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    shade.addColorStop(0, sea);
    shade.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = shade;
    g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.fill();

    const l0 = this.lon * RAD;
    const p0 = this.lat * RAD;
    const sp0 = Math.sin(p0);
    const cp0 = Math.cos(p0);
    const litCode = LIT[this.lit] ?? -1;
    const base = Math.max(0.55, size / 46) * this.dot;
    for (let i = 0; i < LAND.length; i += 3) {
      const l = (LAND[i] / 10) * RAD - l0;
      const p = (LAND[i + 1] / 10) * RAD;
      const sp = Math.sin(p);
      const cpp = Math.cos(p);
      const cl = Math.cos(l);
      const depth = sp0 * sp + cp0 * cpp * cl;
      if (depth <= 0.02) continue;
      const x = cx + r * cpp * Math.sin(l);
      const y = cy - r * (cp0 * sp - sp0 * cpp * cl);
      const on = LAND[i + 2] === litCode;
      g.globalAlpha = (on ? 0.55 : 0.25) + (on ? 0.45 : 0.6) * depth;
      g.fillStyle = on ? lit : land;
      g.beginPath();
      g.arc(x, y, base * (on ? 1.25 : 1) * (0.55 + 0.45 * depth), 0, 2 * Math.PI);
      g.fill();
    }
    g.globalAlpha = 1;
    g.strokeStyle = rim;
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, r, 0, 2 * Math.PI); g.stroke();
  }
}
