/**
 * Playback controller for the preview: real-time play/pause, seek and rate. It owns the
 * current time `t` (seconds); the stage renders from it. Export doesn't use the player — it
 * sets `t` frame by frame.
 */
export interface PlayerState {
  t: number;
  playing: boolean;
  rate: number;
  duration: number;
  loop: boolean;
}

export interface Player {
  get(): PlayerState;
  play(): void;
  pause(): void;
  toggle(): void;
  seek(t: number): void;
  setRate(rate: number): void;
  setDuration(duration: number): void;
  setLoop(loop: boolean): void;
  subscribe(fn: (s: PlayerState) => void): () => void;
  dispose(): void;
}

export interface PlayerDeps {
  /** Defaults to the real requestAnimationFrame / performance.now. */
  raf?: (cb: (ms: number) => void) => number;
  caf?: (id: number) => void;
  now?: () => number;
}

export function createPlayer(duration: number, deps: PlayerDeps = {}): Player {
  const raf = deps.raf ?? ((cb) => requestAnimationFrame(cb));
  const caf = deps.caf ?? ((id) => cancelAnimationFrame(id));
  const now = deps.now ?? (() => performance.now());
  let state: PlayerState = { t: 0, playing: false, rate: 1, duration, loop: false };
  const listeners = new Set<(s: PlayerState) => void>();
  let frame: number | null = null;
  let anchor = { wall: 0, t: 0 };

  const emit = () => listeners.forEach((fn) => fn(state));
  const set = (patch: Partial<PlayerState>) => {
    state = { ...state, ...patch };
    emit();
  };
  const clamp = (t: number) => Math.min(Math.max(t, 0), state.duration);

  function tick() {
    frame = null;
    if (!state.playing) return;
    let t = anchor.t + ((now() - anchor.wall) / 1000) * state.rate;
    if (t >= state.duration) {
      if (state.loop && state.duration > 0) {
        t = t % state.duration;
        anchor = { wall: now(), t };
      } else {
        set({ t: state.duration, playing: false });
        return;
      }
    }
    set({ t });
    frame = raf(tick);
  }

  return {
    get: () => state,
    play() {
      if (state.playing) return;
      const t = state.t >= state.duration ? 0 : state.t;
      anchor = { wall: now(), t };
      set({ playing: true, t });
      frame = raf(tick);
    },
    pause() {
      if (frame !== null) caf(frame);
      frame = null;
      set({ playing: false });
    },
    toggle() {
      if (state.playing) this.pause();
      else this.play();
    },
    seek(t: number) {
      const c = clamp(t);
      anchor = { wall: now(), t: c };
      set({ t: c });
    },
    setRate(rate: number) {
      anchor = { wall: now(), t: state.t };
      set({ rate });
    },
    setDuration(d: number) {
      set({ duration: d, t: Math.min(state.t, d) });
    },
    setLoop(loop: boolean) {
      set({ loop });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    dispose() {
      if (frame !== null) caf(frame);
      listeners.clear();
    },
  };
}
