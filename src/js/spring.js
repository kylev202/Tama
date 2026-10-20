// A damped spring, parameterised the way Apple does it: a perceptual duration and a bounce.
// Springs keep their velocity when retargeted, so changing your mind mid-animation
// reverses smoothly instead of restarting.

export function springParams(duration = 0.5, bounce = 0.2) {
  const stiffness = ((2 * Math.PI) / duration) ** 2;
  const damping = ((1 - bounce) * 4 * Math.PI) / duration;
  return { stiffness, damping };
}

export class Spring {
  constructor(value, params) {
    this.value = value;
    this.target = value;
    this.velocity = 0;
    this.params = params;
  }

  jump(value) {
    this.value = this.target = value;
    this.velocity = 0;
  }

  /** Advances by `dt` seconds. Returns true once at rest. */
  step(dt) {
    const { stiffness, damping } = this.params;
    for (let left = dt; left > 0; left -= 1 / 240) {
      const h = Math.min(left, 1 / 240);
      const accel = -stiffness * (this.value - this.target) - damping * this.velocity;
      this.velocity += accel * h;
      this.value += this.velocity * h;
    }
    if (Math.abs(this.value - this.target) < 0.05 && Math.abs(this.velocity) < 0.5) {
      this.jump(this.target);
      return true;
    }
    return false;
  }
}

/** Animates several named springs together and calls `render` every frame until all rest. */
export function springGroup(initial, params, render) {
  const springs = Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, new Spring(v, params)]));
  let frame = 0;
  let last = 0;
  const values = () => Object.fromEntries(Object.entries(springs).map(([k, s]) => [k, s.value]));
  const tick = (now) => {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    let done = true;
    for (const s of Object.values(springs)) done = s.step(dt) && done;
    render(values());
    frame = done ? 0 : requestAnimationFrame(tick);
  };
  return {
    to(targets, { instant = false } = {}) {
      for (const [k, v] of Object.entries(targets)) {
        if (instant) springs[k].jump(v);
        else springs[k].target = v;
      }
      if (instant) {
        cancelAnimationFrame(frame);
        frame = 0;
        render(values());
      } else if (!frame) {
        last = performance.now();
        frame = requestAnimationFrame(tick);
      }
    },
    get values() {
      return values();
    },
  };
}
