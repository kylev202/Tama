// Tama's cat: a small round milky-white cat with two eyes, drawn procedurally on a canvas.
// Moods: idle, focus (eyes closed, ears relaxed, slow breathing), music (sways), sleepy (late at
// night, ears droop), alert (ears up, wide-eyed flare). Reactions: happy (squint), celebrate
// (squint plus sparks). Antics, while nobody is looking: it yawns, stretches, hops, tilts its
// head, swishes its tail, washes a paw, chases a firefly, and naps with little z's rising.

const W = 48;
const H = 34;
const TAU = Math.PI * 2;

/** Antics: how long each lasts (a nap's length is picked when it starts) and its frame rate. */
const ACTS = {
  yawn: { span: 1900, fps: 30 },
  stretch: { span: 2100, fps: 30 },
  hop: { span: 760, fps: 60 },
  tilt: { span: 1600, fps: 30 },
  tail: { span: 2200, fps: 30 },
  groom: { span: 2400, fps: 30 },
  firefly: { span: 5600, fps: 30 },
  nap: { span: 0, fps: 6 },
};
/** Which antics suit each mood, and how often. Focus and alert keep the cat still. */
const WEIGHTS = {
  idle: { yawn: 2, stretch: 2, hop: 1, tilt: 2, tail: 2, groom: 2, firefly: 1.5, nap: 0.5 },
  music: { hop: 3, tail: 2.5, tilt: 1, groom: 0.5 },
  sleepy: { nap: 6, yawn: 2, stretch: 0.6, groom: 0.6 },
};
const BORED = 4 * 60_000; // left alone this long, an idle cat mostly naps

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const smooth = (x) => {
  const v = clamp01(x);
  return v * v * (3 - 2 * v);
};
/** 0 → 1 → 0 across an antic: eased in over the first `rise` of it and out over the last `fall`. */
const envelope = (p, rise, fall) => Math.min(smooth(p / rise), smooth((1 - p) / fall));

/** `scale` draws it larger (the website's hero); the island uses 1. */
export function createCat(canvas, { scale = 1 } = {}) {
  const ctx = canvas.getContext('2d');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let dpr = 0;

  // The accent from Personalise colours the glow, eyes and sparks; k scales every chroma, so
  // Silver's glow is nearly grey.
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
  let ears = 0; // -1 drooped, 0 resting, 1 pricked up
  let earsTarget = 0;
  let pop = 0; // extra scale that springs back after a reaction
  const sparks = [];
  // At rest the cat holds still between short twitches (an ear flick and a little sway):
  // every visible canvas frame makes the transparent window recomposite, so constant motion
  // would cost ~10% of a core.
  let twitchStart = 0;
  let twitchUntil = 0;
  let twitchSide = 1;
  let nextTwitch = performance.now() + 3000;
  let dirty = true;
  // Antics: one at a time, every 12-26 s while idle. `ending` eases one out early when
  // someone looks, the mood changes or a reaction plays.
  let antics = true;
  let act = null; // { kind, start, span, side, ending, popped }
  let nextAct = performance.now() + 9000 + Math.random() * 9000;
  let attendedAt = performance.now();
  const zs = []; // a napping cat's z's: { x, y, born }
  let nextZ = 0;
  let fly = null; // the firefly's position while it's out

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
    const settling = blinkStart >= 0 || eyesMoving || Math.abs(glow - glowTarget) > 0.01 || Math.abs(ears - earsTarget) > 0.01 || pop > 0.002;
    if (act) return Math.max(ACTS[act.kind].fps, settling || act.ending ? 30 : 0, zs.length ? 12 : 0);
    if (settling) return 30;
    if (zs.length) return 12;
    if (now < twitchUntil) return 30;
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

  /** Starts the small events that keep it alive: blinks, glances, twitches. */
  function schedule(now) {
    if (reaction && now > reaction.until) {
      reaction = null;
      dirty = true;
    }

    // Blinks, sometimes doubled. Sleepy cats blink slowly.
    if (now > nextBlink && mood !== 'focus') {
      blinkStart = now;
      const double = Math.random() < 0.15;
      nextBlink = now + (double ? 260 : (mood === 'sleepy' ? 6000 : 3500) + Math.random() * 4500);
    }

    // Antics come and go.
    if (act && (act.ending ? now - act.ending > 280 : now - act.start > act.span)) {
      if (act.kind === 'nap') blinkStart = now; // waking up
      act = null;
      fly = null;
      dirty = true;
      nextAct = now + gap();
    }
    if (!act && now > nextAct) {
      if (canAct()) startAct(now, pickAct(now));
      else nextAct = now + 4000;
    }
    if (act) perform(now);

    // When nobody is pointing at it, it glances around now and then (an antic sets its own gaze).
    if (!act && (!attentive || now - pointerAt > 1500)) {
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

    // Now and then an ear flicks (even in its sleep); more often while music plays.
    if (now > nextTwitch && !reduced.matches && mood !== 'focus' && (!act || act.kind === 'nap')) {
      twitchStart = now;
      twitchUntil = now + 900 + Math.random() * 700;
      twitchSide = Math.random() < 0.5 ? -1 : 1;
      nextTwitch = now + (mood === 'music' ? 2200 + Math.random() * 1800 : 6500 + Math.random() * 7000);
    }
  }

  /* Antics */

  const canAct = () => antics && !reduced.matches && !attentive && !reaction && mood in WEIGHTS;

  /** The pause before the next antic: short while music plays or between naps. */
  function gap() {
    if (mood === 'music') return 6000 + Math.random() * 6000;
    if (mood === 'sleepy') return 4000 + Math.random() * 5000;
    return 12000 + Math.random() * 14000;
  }

  function pickAct(now) {
    const weights = { ...WEIGHTS[mood] };
    if (mood === 'idle' && now - attendedAt > BORED) weights.nap = 6;
    let roll = Math.random() * Object.values(weights).reduce((a, b) => a + b, 0);
    for (const [kind, weight] of Object.entries(weights)) {
      roll -= weight;
      if (roll <= 0) return kind;
    }
    return 'yawn';
  }

  function startAct(now, kind) {
    const span = kind === 'nap' ? (mood === 'sleepy' ? 30000 : 15000) * (1 + Math.random()) : ACTS[kind].span;
    act = { kind, start: now, span, side: Math.random() < 0.5 ? -1 : 1, ending: 0, popped: false };
    nextZ = now + 1400;
  }

  /** Eases the current antic out over 280 ms. */
  function endAct(now = performance.now()) {
    if (act && !act.ending) act.ending = now;
  }

  /** Per-frame business of an antic: where the eyes go, z's while napping, the firefly. While
   *  it eases out, the eyes are left to whoever is looking. */
  function perform(now) {
    const p = clamp01((now - act.start) / act.span);
    const t = (now - act.start) / 1000;
    const gaze = (x, y) => {
      if (act.ending) return;
      look.tx = x;
      look.ty = y;
    };
    if (act.kind === 'tilt') {
      gaze(act.side * 0.5 * envelope(p, 0.2, 0.3), -0.35 * envelope(p, 0.2, 0.3));
    } else if (act.kind === 'groom' || act.kind === 'yawn') {
      gaze(0, 0);
    } else if (act.kind === 'nap') {
      gaze(0, 0.3);
      if (now > nextZ && !act.ending && p > 0.08 && p < 0.92) {
        zs.push({ x: W / 2 + 5, y: 11, born: now });
        nextZ = now + 2100 + Math.random() * 700;
      }
    } else if (act.kind === 'firefly' && !act.popped) {
      // It drifts in from one side, loops above the cat's head, and gets pounced on.
      const from = act.side > 0 ? W + 4 : -4;
      const arrive = smooth(p / 0.55);
      const x = from + (W / 2 + act.side * 3 - from) * arrive + Math.sin(t * 2.3) * 3.2 * (0.4 + arrive * 0.6);
      const y = 6 + arrive * 1.5 + Math.sin(t * 3.1 + 1) * 2.2;
      const fade = act.ending ? 1 - clamp01((now - act.ending) / 280) : 1;
      fly = { x, y, alpha: smooth(p / 0.12) * fade * (0.75 + Math.sin(t * 9) * 0.25) };
      gaze(Math.max(-1, Math.min(1, (x - W / 2) / 12)), Math.max(-0.5, Math.min(1, (y - 20) / 9)));
      if (p > 0.86) {
        act.popped = true;
        if (!act.ending) burst(7, x, y, 0.55);
        fly = null;
      }
    }
  }

  /** How the current antic bends the resting pose. Deviations scale down as it eases out. */
  function actPose(now) {
    const pose = { dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, ears: 0, earSkew: 0, eyes: null, mouth: 0, paw: 0, lick: 0, tail: 0, swish: 0 };
    if (!act) return pose;
    const p = clamp01((now - act.start) / act.span);
    const t = (now - act.start) / 1000;
    const side = act.side;
    if (act.kind === 'yawn') {
      const open = envelope(p, 0.32, 0.36);
      pose.mouth = open;
      pose.sy = 1 + 0.07 * open;
      pose.sx = 1 - 0.03 * open;
      pose.ears = -0.5 * open;
      if (open > 0.25) pose.eyes = 'squeeze';
    } else if (act.kind === 'stretch') {
      // Long and low, eyes shut, then a small rebound as it settles.
      const reach = envelope(p, 0.35, 0.3);
      pose.sx = 1 + 0.2 * reach;
      pose.sy = 1 - 0.16 * reach + (p > 0.7 ? 0.04 * Math.sin(((p - 0.7) / 0.3) * Math.PI) : 0);
      pose.dx = side * 1.2 * reach;
      pose.rot = side * 0.05 * reach;
      pose.ears = -0.45 * reach;
      if (reach > 0.3) pose.eyes = 'closed';
    } else if (act.kind === 'hop' || (act.kind === 'firefly' && p > 0.8 && p < 0.97)) {
      // Crouch, jump, land. The firefly's pounce is the same hop, toward it.
      const h = act.kind === 'hop' ? p : (p - 0.8) / 0.17;
      if (h < 0.2) {
        const squash = Math.sin((h / 0.2) * Math.PI);
        pose.sy = 1 - 0.1 * squash;
        pose.sx = 1 + 0.08 * squash;
      } else if (h < 0.8) {
        const air = Math.sin(((h - 0.2) / 0.6) * Math.PI);
        pose.dy = -5 * air;
        pose.sy = 1 + 0.06 * air;
        pose.sx = 1 - 0.04 * air;
        pose.ears = 0.5 * air;
        if (act.kind === 'firefly') pose.dx = side * 2.5 * air;
      } else {
        const squash = Math.sin(((h - 0.8) / 0.2) * Math.PI);
        pose.sy = 1 - 0.08 * squash;
        pose.sx = 1 + 0.06 * squash;
      }
    } else if (act.kind === 'tilt') {
      const lean = envelope(p, 0.2, 0.3);
      pose.rot = side * 0.2 * lean;
      pose.earSkew = 0.3 * lean;
    } else if (act.kind === 'tail') {
      pose.tail = envelope(p, 0.15, 0.2);
      pose.swish = Math.sin(t * 6.5);
    } else if (act.kind === 'groom') {
      const up = envelope(p, 0.18, 0.2);
      pose.paw = up;
      pose.lick = (Math.sin(t * 11) * 0.5 + 0.5) * up;
      pose.rot = side * 0.06 * up;
      if (up > 0.3) pose.eyes = 'happy';
    } else if (act.kind === 'nap') {
      const sleep = envelope(p, 0.06, 0.04);
      pose.eyes = sleep > 0.4 ? 'closed' : null;
      pose.ears = -0.7 * sleep;
      pose.sx = 1 + 0.04 * sleep;
      pose.sy = 1 - 0.05 * sleep + Math.sin((t * TAU) / 3.6) * 0.025 * sleep; // slow breaths
      pose.dy = 0.6 * sleep;
    }
    if (act.kind === 'firefly') {
      pose.ears = Math.max(pose.ears, 0.6 * envelope(p, 0.15, 0.1));
      if (act.popped && p > 0.9) pose.eyes = 'happy'; // caught it
    }
    const fade = act.ending ? 1 - clamp01((now - act.ending) / 280) : 1;
    if (fade < 1) {
      for (const key of ['dx', 'dy', 'rot', 'ears', 'earSkew', 'mouth', 'paw', 'lick', 'tail']) pose[key] *= fade;
      pose.sx = 1 + (pose.sx - 1) * fade;
      pose.sy = 1 + (pose.sy - 1) * fade;
      if (fade < 0.5) pose.eyes = null;
    }
    return pose;
  }

  function update(now, dt) {
    // Eyes follow their target through a spring rather than snapping. Stepped at no more than
    // 1/60 s, so it stays stable at the slow frame rates of a nap or focus.
    const k = 140;
    const c = 2 * Math.sqrt(k);
    for (let left = dt; left > 0; left -= 1 / 60) {
      const h = Math.min(left, 1 / 60);
      look.vx += (-k * (look.x - look.tx) - c * look.vx) * h;
      look.vy += (-k * (look.y - look.ty) - c * look.vy) * h;
      look.x += look.vx * h;
      look.y += look.vy * h;
    }

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

    // Ears droop when sleepy, relax in focus, and prick up when someone is looking.
    earsTarget = mood === 'sleepy' ? -1 : mood === 'focus' ? -0.35 : mood === 'alert' ? 1 : 0;
    if (attentive) earsTarget = Math.min(1, earsTarget + 0.5);
    if (reaction) earsTarget = Math.max(earsTarget, 0.7);
    ears += (earsTarget - ears) * Math.min(1, dt * 8);

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
    for (let i = zs.length - 1; i >= 0; i--) if (now - zs[i].born > 2600) zs.splice(i, 1);
  }

  function burst(count, x = W / 2, y = 20, strength = 1) {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * TAU + Math.random() * 0.4;
      const speed = (26 + Math.random() * 24) * strength;
      const life = 0.55 + Math.random() * 0.35;
      sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life,
        span: life,
        size: 0.9 + Math.random() * 0.7,
      });
    }
  }

  function draw(now) {
    resize();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const t = now / 1000;
    // Motion envelope: full while looked at; at rest only during a twitch, eased in and out
    // so the frame it settles on is the neutral pose.
    const twitch = now < twitchUntil ? Math.max(0, Math.min(1, (now - twitchStart) / 220, (twitchUntil - now) / 320)) : 0;
    const motion = reduced.matches ? 0 : attentive || mood === 'alert' ? 1 : twitch;
    const still = motion === 0;

    const bob = Math.sin((t * TAU) / (mood === 'sleepy' ? 4.2 : 2.8)) * 0.9 * motion;
    const size = 1 + pop + (mood === 'alert' ? 0.08 : 0) + (attentive ? 0.04 : 0);
    const pose = actPose(now);
    const rx = 8.6 * size * pose.sx;
    const ry = 7.4 * size * pose.sy;
    const cx = W / 2 + pose.dx;
    // Squashing keeps it sitting where it sits.
    const cy = 20 + bob + (mood === 'sleepy' ? 0.5 : 0) + pose.dy + 7.4 * size - ry;

    // Halo
    const halo = ctx.createRadialGradient(cx, cy - 1.5, 0, cx, cy - 1.5, rx * 2.4);
    halo.addColorStop(0, `oklch(0.84 ${0.105 * k} ${hue} / ${0.4 * glow})`);
    halo.addColorStop(1, `oklch(0.84 ${0.105 * k} ${hue} / 0)`);
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // It sways from where it sits; music sways it most.
    const swayAmount = (mood === 'music' ? 1.9 : mood === 'focus' ? 0.5 : 1) * motion;
    const sway = still ? 0 : (Math.sin(t * 3.1) * 0.9 + Math.sin(t * 5.3 + 1.3) * 0.5) * swayAmount;
    ctx.save();
    ctx.translate(cx, cy + ry);
    ctx.rotate(sway * 0.025 + pose.rot);
    ctx.translate(-cx, -cy - ry);

    if (pose.tail > 0.01) drawTail(t, cx, cy, rx, ry, pose);

    // Milky white whatever the accent; the halo carries the colour.
    const body = ctx.createRadialGradient(cx - rx * 0.25, cy + ry * 0.15, 0, cx, cy - ry * 0.2, rx * 1.9);
    body.addColorStop(0, 'oklch(0.995 0.004 95)');
    body.addColorStop(0.4, `oklch(${0.95 + glow * 0.02} 0.01 90)`);
    body.addColorStop(1, 'oklch(0.8 0.016 85)');
    ctx.fillStyle = body;
    ctx.beginPath();

    // Ears: rounded triangles rising from the top of the head, both wound the same way as the
    // head so the three fill as one shape. One flicks back during a twitch.
    const flickAt = reduced.matches ? 1 : (now - twitchStart) / 300;
    const flick = flickAt < 1 ? Math.sin(flickAt * Math.PI) * 0.5 : 0;
    const earPose = Math.max(-1, Math.min(1, ears + pose.ears));
    const tilt = 0.3 + (earPose < 0 ? -earPose * 0.75 : -earPose * 0.16);
    const len = 5.6 * size * (1 + earPose * 0.1);
    const round = 0.3;
    for (const side of [-1, 1]) {
      const ox = cx + side * rx * 0.86;
      const oy = cy - ry * 0.5;
      const ix = cx + side * rx * 0.3;
      const iy = cy - ry * 0.95;
      // A head tilt lowers the ear on that side and lifts the other a little.
      const skew = act ? (side === act.side ? pose.earSkew : -pose.earSkew * 0.4) : 0;
      const a = tilt + (side === twitchSide ? flick : 0) + skew;
      const tipX = (ox + ix) / 2 + side * Math.sin(a) * len + look.x * 0.8;
      const tipY = (oy + iy) / 2 - Math.cos(a) * len;
      const [x1, y1, x2, y2] = side < 0 ? [ox, oy, ix, iy] : [ix, iy, ox, oy];
      ctx.moveTo(x1, y1);
      ctx.lineTo(tipX + (x1 - tipX) * round, tipY + (y1 - tipY) * round);
      ctx.quadraticCurveTo(tipX, tipY, tipX + (x2 - tipX) * round, tipY + (y2 - tipY) * round);
      ctx.lineTo(x2, y2);
      ctx.closePath();
    }

    // Head and body in one: a round loaf, a little squarer where it sits.
    ctx.moveTo(cx - rx, cy);
    ctx.bezierCurveTo(cx - rx, cy - ry * 0.56, cx - rx * 0.56, cy - ry, cx, cy - ry);
    ctx.bezierCurveTo(cx + rx * 0.56, cy - ry, cx + rx, cy - ry * 0.56, cx + rx, cy);
    ctx.bezierCurveTo(cx + rx, cy + ry * 0.68, cx + rx * 0.68, cy + ry, cx, cy + ry);
    ctx.bezierCurveTo(cx - rx * 0.68, cy + ry, cx - rx, cy + ry * 0.68, cx - rx, cy);
    // A soft shadow keeps the white shape readable on the Light theme; on black it vanishes.
    // Shadows ignore the transform, so they're sized in device pixels.
    ctx.shadowColor = 'oklch(0.3 0.02 85 / 0.4)';
    ctx.shadowBlur = 1.8 * dpr;
    ctx.shadowOffsetY = 0.5 * dpr;
    ctx.fill();
    ctx.shadowColor = 'transparent';

    drawEyes(now, cx, cy, rx, pose.eyes);
    if (pose.mouth > 0.02) {
      // A yawn
      ctx.beginPath();
      ctx.ellipse(cx, cy + 3.4, 0.4 + pose.mouth * 1.1, pose.mouth * 1.7, 0, 0, TAU);
      ctx.fill();
    }
    if (pose.paw > 0.01) drawPaw(cx, cy, rx, ry, pose);
    ctx.restore();

    if (zs.length) drawZs(now);
    if (fly) drawFirefly(fly);

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

  /** `shape` is an antic's eyes: 'closed', 'happy' or 'squeeze' (a yawn's > <). */
  function drawEyes(now, cx, cy, rx, shape) {
    const spread = rx * 0.36;
    const ex = look.x * 1.6;
    const ey = look.y * 1.1;
    const y = cy + 0.3 + ey;
    const eye = `oklch(0.2 ${0.03 * k} ${hue + 15})`;
    ctx.fillStyle = eye;
    ctx.strokeStyle = eye;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.15;

    // A blink ends even while the eyes are drawn shut, so it can't hold the frame rate up.
    let blink = 1;
    if (blinkStart >= 0) {
      const p = (now - blinkStart) / 150;
      if (p >= 1) blinkStart = -1;
      else blink = Math.max(0.12, Math.abs(1 - p * 2));
    }

    const happy = (reaction && (reaction.kind === 'happy' || reaction.kind === 'celebrate')) || shape === 'happy';
    for (const side of [-1, 1]) {
      const x = cx + side * spread + ex;
      if (happy) {
        // ^ ^
        ctx.beginPath();
        ctx.moveTo(x - 1.35, y + 0.7);
        ctx.quadraticCurveTo(x, y - 1.5, x + 1.35, y + 0.7);
        ctx.stroke();
      } else if (shape === 'squeeze') {
        // > <
        ctx.beginPath();
        ctx.moveTo(x - side * 1.2, y - 1.1);
        ctx.lineTo(x + side * 0.9, y);
        ctx.lineTo(x - side * 1.2, y + 1.1);
        ctx.stroke();
      } else if (mood === 'focus' || shape === 'closed') {
        // Calm closed eyes
        ctx.beginPath();
        ctx.moveTo(x - 1.3, y);
        ctx.quadraticCurveTo(x, y + 1.3, x + 1.3, y);
        ctx.stroke();
      } else {
        const open = (mood === 'sleepy' ? 0.45 : mood === 'alert' ? 1.2 : 1) * blink;
        const w = mood === 'alert' ? 2.1 : 1.9;
        const h = Math.max(0.6, 3.3 * open);
        ctx.beginPath();
        ctx.roundRect(x - w / 2, y - h / 2, w, h, w / 2);
        ctx.fill();
      }
    }
  }

  /** The tail curls up from behind one haunch and swishes. Drawn before the body. */
  function drawTail(t, cx, cy, rx, ry, pose) {
    const side = act?.side ?? 1;
    const baseX = cx + side * rx * 0.55;
    const baseY = cy + ry * 0.86;
    const reach = pose.tail;
    const tipX = baseX + side * (2 + reach * (4.2 + pose.swish * 1.3));
    const tipY = baseY - 1 - reach * (10 + pose.swish * 0.8);
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.bezierCurveTo(baseX + side * 5 * reach, baseY + 0.6, tipX + side * 2.2 * reach, tipY + 5 * reach, tipX, tipY);
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'oklch(0.92 0.012 88)';
    ctx.shadowColor = 'oklch(0.3 0.02 85 / 0.4)';
    ctx.shadowBlur = 1.4 * dpr;
    ctx.stroke();
    ctx.shadowColor = 'transparent';
  }

  /** A paw raised to the face for a wash, bobbing as it's licked. Drawn over the eyes. */
  function drawPaw(cx, cy, rx, ry, pose) {
    const side = act?.side ?? 1;
    const x = cx + side * rx * 0.48;
    const y = cy + ry * 0.62 - pose.paw * 3.4 - pose.lick * 1.2;
    ctx.beginPath();
    ctx.ellipse(x, y, 1.9, 1.5, side * 0.3, 0, TAU);
    ctx.fillStyle = 'oklch(0.985 0.005 90)';
    ctx.shadowColor = 'oklch(0.3 0.02 85 / 0.45)';
    ctx.shadowBlur = 1.2 * dpr;
    ctx.fill();
    ctx.shadowColor = 'transparent';
  }

  /** z's float up from a napping cat, drifting and growing as they fade. */
  function drawZs(now) {
    ctx.lineWidth = 0.8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const z of zs) {
      const age = (now - z.born) / 2600;
      const alpha = Math.min(smooth(age / 0.2), smooth((1 - age) / 0.45));
      const s = 0.9 + age * 1.1;
      const x = z.x + age * 5 + Math.sin(age * 5) * 0.8;
      const y = z.y - age * 9;
      // Mid lightness, so they read on the black island, the Light one and a bare desktop.
      ctx.strokeStyle = `oklch(0.78 ${0.09 * k} ${hue} / ${alpha * 0.95})`;
      ctx.beginPath();
      ctx.moveTo(x - s, y - s);
      ctx.lineTo(x + s, y - s);
      ctx.lineTo(x - s, y + s);
      ctx.lineTo(x + s, y + s);
      ctx.stroke();
    }
  }

  function drawFirefly({ x, y, alpha }) {
    const glowing = ctx.createRadialGradient(x, y, 0, x, y, 3.6);
    glowing.addColorStop(0, `oklch(0.84 ${0.12 * k} ${hue} / ${0.65 * alpha})`);
    glowing.addColorStop(1, `oklch(0.84 ${0.12 * k} ${hue} / 0)`);
    ctx.fillStyle = glowing;
    ctx.fillRect(x - 4, y - 4, 8, 8);
    ctx.fillStyle = `oklch(0.97 ${0.06 * k} ${hue} / ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.8, 0, TAU);
    ctx.fill();
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
    /** Tints the cat's glow, eyes and sparks with an accent: `{ c, h }` in OKLCH. */
    setTint({ c, h }) {
      hue = h;
      k = c / 0.105;
      dirty = true;
    },
    setMood(next) {
      if (next === mood) return;
      mood = next;
      dirty = true;
      if (act && !(act.kind in (WEIGHTS[mood] ?? {}))) endAct(); // music wakes a nap; focus stills it
    },
    /** Whether it gets up to antics while left alone. */
    setAntics(value) {
      antics = value;
      if (!value) endAct();
    },
    setAttentive(value) {
      if (value === attentive) return;
      attentive = value;
      dirty = true;
      attendedAt = performance.now();
      if (value && act) {
        if (act.kind === 'nap') pop = 0.1; // woken with a start
        endAct();
      }
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
      endAct(now);
      reaction = { kind, until: now + (kind === 'celebrate' ? 1600 : 1000) };
      pop = kind === 'celebrate' ? 0.22 : 0.12;
      if (kind === 'celebrate' && !reduced.matches) burst(14);
    },
  };
}
