/**
 * A virtual clock for frame-exact rendering. While installed, time-reading and scheduling
 * APIs follow a time we set instead of the wall clock:
 *   Date.now, new Date(), performance.now, requestAnimationFrame, cancelAnimationFrame,
 *   setTimeout, clearTimeout, setInterval, clearInterval
 * so code that (wrongly) depends on them still renders the same frame for the same `t`.
 * Export always runs under it; overlays must not rely on it (they read `t` from context).
 */
export interface VirtualClock {
  /** Current virtual time in ms (0 at install). */
  now(): number;
  /** Moves time forward to `ms`, running due timers and animation-frame callbacks in order. */
  advanceTo(ms: number): void;
  restore(): void;
}

interface Timer {
  id: number;
  at: number;
  fn: (...args: unknown[]) => void;
  args: unknown[];
  interval: number | null;
}

type G = typeof globalThis & {
  requestAnimationFrame?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};

export function installVirtualClock(target: G = globalThis as G, epochMs = 1_700_000_000_000): VirtualClock {
  const original = {
    DateNow: target.Date.now,
    Date: target.Date,
    perfNow: target.performance?.now.bind(target.performance),
    raf: target.requestAnimationFrame,
    caf: target.cancelAnimationFrame,
    setTimeout: target.setTimeout,
    clearTimeout: target.clearTimeout,
    setInterval: target.setInterval,
    clearInterval: target.clearInterval,
  };
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, Timer>();
  const frames = new Map<number, FrameRequestCallback>();

  const RealDate = original.Date;
  class VirtualDate extends RealDate {
    constructor(...args: ConstructorParameters<typeof Date> | []) {
      if (args.length === 0) super(epochMs + now);
      else super(...(args as ConstructorParameters<typeof Date>));
    }
    static override now() {
      return epochMs + now;
    }
  }

  target.Date = VirtualDate as DateConstructor;
  if (target.performance) target.performance.now = () => now;
  target.requestAnimationFrame = (cb: FrameRequestCallback) => {
    const id = nextId++;
    frames.set(id, cb);
    return id;
  };
  target.cancelAnimationFrame = (id: number) => void frames.delete(id);
  const schedule = (fn: unknown, delay: unknown, args: unknown[], repeat: boolean) => {
    const id = nextId++;
    const d = Math.max(0, Number(delay) || 0);
    timers.set(id, {
      id,
      at: now + d,
      fn: fn as Timer['fn'],
      args,
      interval: repeat ? Math.max(1, d) : null,
    });
    return id;
  };
  target.setTimeout = ((fn: unknown, delay?: unknown, ...args: unknown[]) =>
    schedule(fn, delay, args, false)) as unknown as typeof setTimeout;
  target.setInterval = ((fn: unknown, delay?: unknown, ...args: unknown[]) =>
    schedule(fn, delay, args, true)) as unknown as typeof setInterval;
  target.clearTimeout = ((id: number) => void timers.delete(id)) as typeof clearTimeout;
  target.clearInterval = ((id: number) => void timers.delete(id)) as typeof clearInterval;

  return {
    now: () => now,
    advanceTo(ms: number) {
      if (ms < now) {
        // Seeking backwards: pending timers are relative to the old timeline; drop them.
        timers.clear();
        now = ms;
      }
      for (;;) {
        const due = [...timers.values()]
          .filter((t) => t.at <= ms)
          .sort((a, b) => a.at - b.at || a.id - b.id)[0];
        if (!due) break;
        now = due.at;
        if (due.interval !== null) due.at += due.interval;
        else timers.delete(due.id);
        due.fn(...due.args);
      }
      now = ms;
      const cbs = [...frames.values()];
      frames.clear();
      for (const cb of cbs) cb(now);
    },
    restore() {
      target.Date = original.Date;
      target.Date.now = original.DateNow;
      if (target.performance && original.perfNow) target.performance.now = original.perfNow;
      target.requestAnimationFrame = original.raf as G['requestAnimationFrame'];
      target.cancelAnimationFrame = original.caf as G['cancelAnimationFrame'];
      target.setTimeout = original.setTimeout;
      target.clearTimeout = original.clearTimeout;
      target.setInterval = original.setInterval;
      target.clearInterval = original.clearInterval;
    },
  };
}
