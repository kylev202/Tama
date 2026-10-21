// The soul: a small spirit-flame with two eyes, drawn procedurally on a canvas.
// Moods: idle, focus (eyes closed, slow breathing), music (sways), sleepy (late at night),
// alert (wide-eyed flare). Reactions: happy (squint), celebrate (squint plus sparks).

const W = 48;
const H = 34;
const TAU = Math.PI * 2;

/** `scale` draws it larger (the website's hero); the island uses 1. */
export function createSoul(canvas, { scale = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let dpr = 0;

  // The accent from Personalise; k scales every chroma, so Silver gives a pale ghost.
  let hue = 200;
  let k = 1;

  let mood = 'idle';
  let attentive = false; // hovered or open: brighter, eyes follow the pointer
  let reaction = null; // { kind, start, until }
  const look = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  let pointerAt = 0;
  let blinkStart = -1;
  let nextBlink = performance.now() + 2200;
  let nextGlance = performance.now() + 3500;
  let glanceUntil = 0;
  let glow = 0.7;
  let glowTarget = 0.7;
  let pop = 0; // extra scale that springs back after a reaction
  let nextSpark = 0;
  const sparks = [];
  // At rest the soul holds still between short flickers: every visible canvas frame makes
  // the transparent window recomposite, so constant motion would cost ~10% of a core.
  let flickerStart = 0;
  let flickerUntil = 0;
  let nextFlicker = performance.now() + 3000;
  let dirty = true;

  let frame = 0;
  let last = 0;
  let running = false;

  function resize() {
    const ratio = Math.max(1, window.devicePixelRatio || 1) * scale;
    if (ratio === dpr) return;
    dpr = ratio;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }

  /** Frames per second needed right now; 0 means nothing visible would change. */
  function rate(now) {
    if (attentive || reaction || sparks.length > 0 || mood === 'alert') return 60;
    const eyesMoving =
      Math.abs(look.x - look.tx) > 0.01 || Math.abs(look.y - look.ty) > 0.01 || Math.abs(look.vx) + Math.abs(look.vy) > 0.05;
    if (blinkStart >= 0 || eyesMoving || Math.abs(glow - glowTarget) > 0.01 || pop > 0.002) return 30;
    if (now < flickerUntil) return 24;
    if (mood === 'focus') return 5; // slow breathing
    return dirty ? 30 : 0;
  }

  function loop(now) {
    frame = requestAnimationFrame(loop);
    schedule(now);
    const fps = rate(now);
    if (!fps) {
      last = now;
      return;
    }
    if (now - last < 1000 / fps - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    update(now, dt);
    draw(now);
    dirty = false;
  }

  /** Starts the small events that keep it alive: blinks, glances, flickers. */
  function schedule(now) {
    if (reaction && now > reaction.until) {
      reaction = null;
      dirty = true;
    }

    // Blinks, sometimes doubled. Sleepy souls blink slowly.
    if (now > nextBlink && mood !== 'focus') {
      blinkStart = now;
      const double = Math.random() < 0.15;
      nextBlink = now + (double ? 260 : (mood === 'sleepy' ? 6000 : 3500) + Math.random() * 4500);
    }

    // When nobody is pointing at it, it glances around now and then.
    if (!attentive || now - pointerAt > 1500) {
      if (now > nextGlance && !reduced.matches) {
        look.tx = (Math.random() * 2 - 1) * 0.9;
        look.ty = Math.random() * 0.8 - 0.3;
        glanceUntil = now + 800 + Math.random() * 900;
        nextGlance = now + (attentive ? 3500 : 12000) + Math.random() * 10000;
      } else if (now > glanceUntil) {
        look.tx = 0;
        look.ty = mood === 'focus' ? 0.4 : 0;
      }
    }

    // A short flicker of the flame; more often while music plays.
    if (now > nextFlicker && !reduced.matches && mood !== 'focus') {
      flickerStart = now;
      flickerUntil = now + 900 + Math.random() * 700;
      nextFlicker = now + (mood === 'music' ? 2200 + Math.random() * 1800 : 6500 + Math.random() * 7000);
    }
  }

  function update(now, dt) {
    // Eyes follow their target through a spring rather than snapping.
    const k = 140;
    const c = 2 * Math.sqrt(k);
    look.vx += (-k * (look.x - look.tx) - c * look.vx) * dt;
    look.vy += (-k * (look.y - look.ty) - c * look.vy) * dt;
    look.x += look.vx * dt;
    look.y += look.vy * dt;

    const t = now / 1000;
    glowTarget = 0.66;
    if (attentive) glowTarget = 0.92;
    if (mood === 'focus') glowTarget = 0.56 + Math.sin((t * TAU) / 4.5) * 0.14;
    if (mood === 'music') glowTarget = 0.76;
    if (mood === 'sleepy') glowTarget = 0.5;
    if (mood === 'alert') glowTarget = 1.15 + Math.sin(t * TAU * 1.6) * 0.15;
    if (reaction) glowTarget = 1.1;
    glow += (glowTarget - glow) * Math.min(1, dt * 6);
    pop += (0 - pop) * Math.min(1, dt * 5);

    // Stray sparks leave the tip while someone is looking at it.
    if (attentive && !reduced.matches && now > nextSpark && mood !== 'sleepy') {
      emit(1, { burst: false });
      nextSpark = now + 700 + Math.random() * 1400;
    }
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.life -= dt;
      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }
      s.vy -= 6 * dt; // embers drift upward
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  function emit(count, { burst }) {
    const t = performance.now() / 1000;
    for (let i = 0; i < count; i++) {
      const angle = burst ? (i / count) * TAU + Math.random() * 0.4 : -Math.PI / 2 + (Math.random() - 0.5) * 0.9;
      const speed = burst ? 26 + Math.random() * 24 : 7 + Math.random() * 6;
      const life = burst ? 0.55 + Math.random() * 0.35 : 0.9 + Math.random() * 0.6;
      sparks.push({
        x: W / 2 + Math.sin(t * 3) * 0.8,
        y: burst ? 19 : 8,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        span: life,
        size: burst ? 0.9 + Math.random() * 0.7 : 0.6 + Math.random() * 0.4,
      });
    }
  }

  function draw(now) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    // Motion envelope: full while looked at; at rest only during a flicker, eased in and out
    // so the frame it settles on is the neutral pose.
    const flicker = now < flickerUntil ? Math.max(0, Math.min(1, (now - flickerStart) / 220, (flickerUntil - now) / 320)) : 0;
    const motion = reduced.matches ? 0 : attentive || mood === 'alert' ? 1 : flicker;
    const still = motion === 0;

    const bob = Math.sin((t * TAU) / (mood === 'sleepy' ? 4.2 : 2.8)) * 0.9 * motion;
    const scale = 1 + pop + (mood === 'alert' ? 0.08 : 0) + (attentive ? 0.04 : 0);
    const R = 7.1 * scale;
    const cx = W / 2;
    const cy = 20.5 + bob;

    // Halo
    const halo = ctx.createRadialGradient(cx, cy - 2, 0, cx, cy - 2, R * 2.9);
    halo.addColorStop(0, `oklch(0.84 ${0.105 * k} ${hue} / ${0.4 * glow})`);
    halo.addColorStop(1, `oklch(0.84 ${0.105 * k} ${hue} / 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Body: a round base that rises into a swaying, flickering tip.
    const swayAmount = (mood === 'music' ? 1.9 : mood === 'focus' ? 0.5 : 1) * motion;
    const sway = still ? 0 : (Math.sin(t * 3.1) * 0.9 + Math.sin(t * 5.3 + 1.3) * 0.5) * swayAmount;
    const tremble = still ? 0 : (Math.sin(t * 7.3) * 0.05 + Math.sin(t * 11.7 + 0.6) * 0.04) * motion;
    const tipHeight = R * (1.3 + tremble);
    const tipX = cx + sway + 0.8;
    const tipY = cy - R - tipHeight;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy);
    ctx.arc(cx, cy, R, Math.PI, 0, true);
    ctx.bezierCurveTo(cx + R, cy - R * 0.9, tipX + R * 0.32, tipY + tipHeight * 0.55, tipX, tipY);
    ctx.bezierCurveTo(tipX - R * 0.22, tipY + tipHeight * 0.48, cx - R, cy - R * 0.72, cx - R, cy);
    ctx.closePath();
    const body = ctx.createRadialGradient(cx - R * 0.25, cy + R * 0.2, 0, cx, cy - R * 0.3, R * 2);
    body.addColorStop(0, `oklch(0.985 ${0.02 * k} ${hue})`);
    body.addColorStop(0.4, `oklch(${0.84 + glow * 0.04} ${0.1 * k} ${hue})`);
    body.addColorStop(1, `oklch(0.56 ${0.1 * k} ${hue + 6})`);
    ctx.fillStyle = body;
    ctx.fill();

    drawEyes(now, cx, cy, R);

    // Sparks glow additively.
    if (sparks.length) {
      ctx.globalCompositeOperation = 'lighter';
      for (const s of sparks) {
        const alpha = Math.max(0, s.life / s.span);
        ctx.fillStyle = `oklch(0.9 ${0.09 * k} ${hue} / ${alpha * 0.9})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * (0.6 + alpha * 0.4), 0, TAU);
        ctx.fill();
      }
      ctx.globalCompositeOperation = 'source-over';
    }
  }

  function drawEyes(now, cx, cy, R) {
    const spread = R * 0.38;
    const ex = look.x * 1.5;
    const ey = look.y * 1.1;
    const y = cy - R * 0.05 + ey;
    const eye = `oklch(0.2 ${0.03 * k} ${hue + 15})`;
    ctx.fillStyle = eye;
    ctx.strokeStyle = eye;
    ctx.lineCap = 'round';
    ctx.lineWidth = 1.15;

    const happy = reaction && (reaction.kind === 'happy' || reaction.kind === 'celebrate');
    for (const side of [-1, 1]) {
      const x = cx + side * spread + ex;
      if (happy) {
        // ^ ^
        ctx.beginPath();
        ctx.moveTo(x - 1.35, y + 0.7);
        ctx.quadraticCurveTo(x, y - 1.5, x + 1.35, y + 0.7);
        ctx.stroke();
      } else if (mood === 'focus') {
        // Calm closed eyes
        ctx.beginPath();
        ctx.moveTo(x - 1.3, y);
        ctx.quadraticCurveTo(x, y + 1.3, x + 1.3, y);
        ctx.stroke();
      } else {
        let open = mood === 'sleepy' ? 0.45 : mood === 'alert' ? 1.2 : 1;
        if (blinkStart >= 0) {
          const p = (now - blinkStart) / 150;
          if (p >= 1) blinkStart = -1;
          else open *= Math.max(0.12, Math.abs(1 - p * 2));
        }
        const w = mood === 'alert' ? 2.1 : 1.9;
        const h = Math.max(0.6, 3.3 * open);
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);
        ctx.fill();
      }
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      last = performance.now();
      frame = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      cancelAnimationFrame(frame);
    },
    /** Recolours the soul to an accent: `{ c, h }` in OKLCH. */
    setTint({ c, h }) {
      hue = h;
      k = c / 0.105;
      dirty = true;
    },
    setMood(next) {
      if (next === mood) return;
      mood = next;
      dirty = true;
    },
    setAttentive(value) {
      if (value === attentive) return;
      attentive = value;
      dirty = true;
      if (!value) {
        look.tx = 0;
        look.ty = mood === 'focus' ? 0.4 : 0;
      }
    },
    /** Points the eyes at a client-space position. */
    lookAt(x, y) {
      const box = canvas.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      look.tx = Math.max(-1, Math.min(1, dx / (140 * scale)));
      look.ty = Math.max(-0.5, Math.min(1, dy / (90 * scale)));
      pointerAt = performance.now();
    },
    react(kind) {
      const now = performance.now();
      reaction = { kind, until: now + (kind === 'celebrate' ? 1600 : 1000) };
      pop = kind === 'celebrate' ? 0.22 : 0.12;
      if (kind === 'celebrate' && !reduced.matches) emit(14, { burst: true });
    },
  };
}
