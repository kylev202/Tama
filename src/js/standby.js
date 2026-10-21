// Standby scenes: what rests in the cat's place while the cat is switched off. Each is a small
// drawing on a canvas the cat's size (48 × 34), redrawn only when something in it changes,
// since every visible frame makes the transparent window recomposite. Clock ticks once a
// second, Digits blinks its colon and rolls at the minute, Hourglass trickles at a few frames
// a second and flips each minute, Breathe and Orbit glide at 15.
import { look } from './appearance.js';

const W = 48;
const H = 34;
const CX = W / 2;
const CY = H / 2;
const TAU = Math.PI * 2;

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const v = clamp01(x);
  return v * v * (3 - 2 * v);
};
const sine = (x) => (1 - Math.cos(Math.PI * clamp01(x))) / 2;
/** Eases past the target and back, like a quartz second hand landing. */
const backOut = (x, c = 2) => {
  const v = clamp01(x) - 1;
  return 1 + (c + 1) * v * v * v + c * v * v;
};

export function createStandby(canvas) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let dpr = 0;
  let scene = 'none';
  let tint = { l: 0.84, c: 0.105, h: 200 };
  let light = false;
  let font = 'system-ui, sans-serif';
  let attentive = false;
  let lift = 0; // eases toward 1 while hovered: everything glows a little brighter
  let running = false;
  let frame = 0;
  let last = 0;
  let drawnKey = null;

  // Ink and accent for the island's surface. On Light the accent darkens, as --brand does.
  const ink = (a = 1) => (light ? `oklch(0.2 0 0 / ${a})` : `oklch(0.97 0 0 / ${a})`);
  const accent = (a = 1) => (light ? `oklch(0.52 ${Math.max(tint.c, 0.03)} ${tint.h} / ${a})` : `oklch(${tint.l} ${tint.c} ${tint.h} / ${a})`);
  const bright = (a = 1) => (light ? `oklch(0.62 ${tint.c} ${tint.h} / ${a})` : `oklch(0.96 ${tint.c * 0.45} ${tint.h} / ${a})`);

  function resize() {
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    if (ratio === dpr) return;
    dpr = ratio;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
  }

  /** A soft round glow in the accent. */
  function glow(x, y, r, alpha) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, accent(alpha));
    g.addColorStop(1, accent(0));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }

  /* Scenes. Each says how many frames a second it needs right now (`fps`) and, for changes
     that land on the clock, a `key` that changes when it should redraw anyway. */

  const SCENES = {
    /** A small analogue clock whose second hand ticks and lands with a little overshoot. */
    clock: {
      fps: (wall) => (wall % 1000 < 280 ? 30 : 0),
      key: (wall) => Math.floor(wall / 1000),
      draw(wall) {
        const d = new Date(wall);
        const R = 12.5;
        glow(CX, CY, R + 5, 0.1 + 0.12 * lift);
        circle(CX, CY, R);
        ctx.fillStyle = accent(0.1 + 0.06 * lift);
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = accent(0.45 + 0.3 * lift);
        circle(CX, CY, R - 0.5);
        ctx.stroke();
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * TAU;
          const major = i % 3 === 0;
          circle(CX + Math.sin(a) * (R - 3), CY - Math.cos(a) * (R - 3), major ? 0.75 : 0.45);
          ctx.fillStyle = ink(major ? 0.85 : 0.4);
          ctx.fill();
        }
        const seconds = d.getSeconds();
        const land = reduced.matches ? 1 : backOut((wall % 1000) / 240);
        const minutes = d.getMinutes() + seconds / 60;
        const hours = (d.getHours() % 12) + minutes / 60;
        hand(hours / 12, 5.4, 1.8, ink());
        hand(minutes / 60, 8.4, 1.25, ink());
        hand((seconds - 1 + land) / 60, 9.8, 0.75, accent(), 2.6);
        circle(CX, CY, 1.3);
        ctx.fillStyle = accent();
        ctx.fill();
      },
    },

    /** The time in two pairs of digits. The colon blinks; at the minute the changed digits roll. */
    digits: {
      fps: (wall) => (wall % 60000 < 640 ? 30 : 0),
      key: (wall) => Math.floor(wall / 500),
      draw(wall) {
        const now = clockText(wall);
        const before = clockText(wall - 60000);
        const into = wall % 60000;
        ctx.font = `650 13px ${font}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const digit = Math.max(...'0123456789'.split('').map((c) => ctx.measureText(c).width));
        const colon = ctx.measureText(':').width + 1.5;
        const widths = [...now].map((c) => (c === ':' ? colon : digit));
        let x = CX - widths.reduce((a, b) => a + b, 0) / 2;
        glow(CX, CY, 20, 0.08 + 0.1 * lift);
        // Align from the right, so a 12-hour clock gaining a digit still rolls the right ones.
        const offset = before.length - now.length;
        [...now].forEach((c, i) => {
          const cell = widths[i];
          const cx = x + cell / 2;
          x += cell;
          if (c === ':') {
            const on = reduced.matches || wall % 1000 < 500;
            ctx.fillStyle = accent(on ? 1 : 0.3);
            ctx.fillText(c, cx, CY - 0.5);
            return;
          }
          const old = before[i + offset];
          const p = old === c || reduced.matches ? 1 : smooth((into - (now.length - 1 - i) * 55) / 420);
          ctx.fillStyle = ink(0.92 * p);
          ctx.fillText(c, cx, CY + 0.5 + (1 - p) * 8);
          if (p < 1 && old) {
            ctx.fillStyle = ink(0.92 * (1 - p));
            ctx.fillText(old, cx, CY + 0.5 - p * 8);
          }
        });
      },
    },

    /** Sand runs through the minute; on the minute the glass turns over. */
    hourglass: {
      fps: (wall) => (wall % 60000 < 800 ? 30 : 6),
      key: (wall) => Math.floor(wall / 2000),
      draw(wall) {
        const into = wall % 60000;
        const FLIP = 760;
        const turning = !reduced.matches && into < FLIP;
        const sand = turning ? 1 : clamp01((into - (reduced.matches ? 0 : FLIP)) / (60000 - FLIP));
        ctx.save();
        ctx.translate(CX, CY);
        if (turning) ctx.rotate(Math.PI * backOut(into / FLIP, 1.2));
        glow(0, 0, 16, 0.08 + 0.1 * lift);
        const glass = new Path2D(
          'M-6 -10.5C-6 -4 -1.1 -2.2 -0.9 0C-1.1 2.2 -6 4 -6 10.5L6 10.5C6 4 1.1 2.2 0.9 0C1.1 -2.2 6 -4 6 -10.5Z',
        );
        ctx.save();
        ctx.clip(glass);
        ctx.fillStyle = accent(0.9);
        const top = Math.sqrt(1 - sand) * 9.5; // the wide top bulb empties slowly, then fast
        if (top > 0.05) ctx.fillRect(-7, -top, 14, top);
        const heap = Math.pow(sand, 0.8) * 9;
        if (heap > 0.05) {
          ctx.beginPath();
          ctx.moveTo(-7, 10.5);
          ctx.lineTo(-7, 10.5 - heap + 1.2);
          ctx.quadraticCurveTo(0, 10.5 - heap - 1.6, 7, 10.5 - heap + 1.2);
          ctx.lineTo(7, 10.5);
          ctx.fill();
        }
        if (!turning && sand > 0 && sand < 1) {
          ctx.strokeStyle = accent(0.85);
          ctx.lineWidth = 0.8;
          ctx.setLineDash([1.2, 1.5]);
          ctx.lineDashOffset = reduced.matches ? 0 : -((wall / 1000) * 9);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, 10.5 - heap);
          ctx.stroke();
          ctx.setLineDash([]);
        }
        ctx.restore();
        ctx.strokeStyle = ink(0.42 + 0.25 * lift);
        ctx.lineWidth = 0.9;
        ctx.stroke(glass);
        ctx.strokeStyle = ink(0.9);
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-7.5, -11.6);
        ctx.lineTo(7.5, -11.6);
        ctx.moveTo(-7.5, 11.6);
        ctx.lineTo(7.5, 11.6);
        ctx.stroke();
        ctx.restore();
      },
    },

    /** A glowing orb at a calm breathing pace: in for 4 s, hold, out for 4.5 s. A ring leaves
     *  it as it breathes out. */
    breathe: {
      fps: () => 15,
      key: () => 0,
      draw(wall) {
        const t = reduced.matches ? 4.6 : (wall % 10000) / 1000;
        const b = t < 4 ? sine(t / 4) : t < 5.5 ? 1 : 1 - sine((t - 5.5) / 4.5);
        const r = 4.2 + 3.3 * b;
        glow(CX, CY, r * 2.5, 0.2 + 0.25 * b + 0.15 * lift);
        if (!reduced.matches && t > 5.5 && t < 8) {
          const out = (t - 5.5) / 2.5;
          ctx.strokeStyle = accent(0.4 * (1 - out));
          ctx.lineWidth = 0.8;
          circle(CX, CY, r + 1 + out * 9);
          ctx.stroke();
        }
        const orb = ctx.createRadialGradient(CX - r * 0.3, CY - r * 0.35, 0, CX, CY, r);
        orb.addColorStop(0, bright(1));
        orb.addColorStop(0.65, accent(0.95));
        orb.addColorStop(1, accent(0.75));
        ctx.fillStyle = orb;
        circle(CX, CY, r);
        ctx.fill();
      },
    },

    /** A small planet with a moon on a tilted orbit, passing behind it and round the front,
     *  and a fainter moon further in. */
    orbit: {
      fps: () => 15,
      key: () => 0,
      draw(wall) {
        const t = reduced.matches ? 1.2 : wall / 1000;
        const tilt = -0.32;
        const ring = (a, b, tiltBy, from, to) => {
          ctx.beginPath();
          ctx.ellipse(CX, CY, a, b, tiltBy, from, to);
          ctx.stroke();
        };
        const at = (a, b, tiltBy, angle) => {
          const x = Math.cos(angle) * a;
          const y = Math.sin(angle) * b;
          return [CX + x * Math.cos(tiltBy) - y * Math.sin(tiltBy), CY + x * Math.sin(tiltBy) + y * Math.cos(tiltBy)];
        };
        const moon = (TAU * t) / 7;
        const inner = (-TAU * t) / 4.6 + 1;
        const front = Math.sin(moon) > 0;

        ctx.strokeStyle = ink(0.22 + 0.1 * lift);
        ctx.lineWidth = 0.6;
        ring(15, 4.2, tilt, Math.PI, TAU); // the far half, behind the planet
        if (!front) drawMoon();
        drawInner();

        glow(CX, CY, 9, 0.22 + 0.15 * lift);
        const planet = ctx.createRadialGradient(CX - 1.2, CY - 1.3, 0, CX, CY, 3.6);
        planet.addColorStop(0, bright(1));
        planet.addColorStop(1, accent(0.9));
        ctx.fillStyle = planet;
        circle(CX, CY, 3.4);
        ctx.fill();

        ctx.strokeStyle = ink(0.22 + 0.1 * lift);
        ctx.lineWidth = 0.6;
        ring(15, 4.2, tilt, 0, Math.PI); // the near half, in front
        if (front) drawMoon();

        function drawMoon() {
          // A short tail of fading dots behind it, then the moon, nearer looking bigger.
          for (let i = 4; i >= 0; i--) {
            const [x, y] = at(15, 4.2, tilt, moon - i * 0.09);
            const depth = Math.sin(moon - i * 0.09);
            circle(x, y, (1.5 + depth * 0.45) * (1 - i * 0.14));
            ctx.fillStyle = i === 0 ? ink(0.7 + depth * 0.3) : accent((0.35 - i * 0.07) * (0.7 + depth * 0.3));
            ctx.fill();
          }
        }

        function drawInner() {
          const [x, y] = at(9.5, 7, 0.9, inner);
          circle(x, y, 0.8);
          ctx.fillStyle = accent(0.55);
          ctx.fill();
        }
      },
    },
  };

  function hand(turn, length, width, color, tail = 0) {
    const a = turn * TAU;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(CX - dx * tail, CY - dy * tail);
    ctx.lineTo(CX + dx * length, CY + dy * length);
    ctx.stroke();
  }

  /** "09:41", or "9:41" on a 12-hour clock (the bar beside it says am or pm if it's on). */
  function clockText(wall) {
    const d = new Date(wall);
    const minutes = String(d.getMinutes()).padStart(2, '0');
    if (look().clock24) return `${String(d.getHours()).padStart(2, '0')}:${minutes}`;
    return `${d.getHours() % 12 || 12}:${minutes}`;
  }

  function loop(now) {
    frame = requestAnimationFrame(loop);
    const current = SCENES[scene];
    if (!current) return;
    const wall = Date.now();
    const settling = Math.abs(lift - (attentive ? 1 : 0)) > 0.01;
    const fps = Math.max(settling ? 30 : 0, reduced.matches ? 0 : current.fps(wall));
    const key = current.key(wall);
    if (!(fps && now - last >= 1000 / fps - 2) && key === drawnKey) {
      if (!fps) last = now;
      return;
    }
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    lift += ((attentive ? 1 : 0) - lift) * Math.min(1, dt * 10);
    drawnKey = key;
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    current.draw(wall);
  }

  return {
    start() {
      if (running) return;
      running = true;
      drawnKey = null;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
    /** The scene (a key of STANDBY in appearance.js), the accent `{ l, c, h }`, and whether
     *  the island is Light. Also picks up the display font. */
    configure(next) {
      scene = next.scene;
      tint = next.tint;
      light = next.light;
      font = getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim() || font;
      drawnKey = null;
    },
    setAttentive(value) {
      attentive = value;
    },
  };
}
