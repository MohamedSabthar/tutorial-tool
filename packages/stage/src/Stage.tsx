import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPlayer, type Player, type PlayerState } from './player';
import { TunnelProvider } from './tunnel';

/**
 * The composition root. Everything inside renders from `t` (seconds) alone, on a fixed
 * stage surface (default 1920×1080) that is scaled to fit its container in preview.
 */
export interface StageTime {
  /** Output time in seconds. */
  t: number;
  fps: number;
  /** Stage size in stage pixels. */
  width: number;
  height: number;
  mode: 'preview' | 'export';
}

const TimeContext = createContext<StageTime>({ t: 0, fps: 30, width: 1920, height: 1080, mode: 'preview' });

/** The current stage time. Overlays and scenes must read time only from here. */
export const useStageTime = () => useContext(TimeContext);

/** Frame index for the current time (snapped to fps). */
export const useFrame = () => {
  const { t, fps } = useStageTime();
  return Math.round(t * fps);
};

export interface StageProps {
  t: number;
  fps?: number;
  width?: number;
  height?: number;
  mode?: 'preview' | 'export';
  /** Background behind the composition (letterboxing). */
  background?: string;
  children?: ReactNode;
}

export function Stage({
  t,
  fps = 30,
  width = 1920,
  height = 1080,
  mode = 'preview',
  background = '#0C1526',
  children,
}: StageProps) {
  const host = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    if (mode === 'export' || !host.current) return;
    const el = host.current;
    const fit = () => setScale(Math.min(el.clientWidth / width, el.clientHeight / height) || 1);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [mode, width, height]);

  const surface = (
    <div
      data-stage-surface=""
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background,
        transformOrigin: '0 0',
        transform: mode === 'export' ? undefined : `scale(${scale})`,
        contain: 'strict',
      }}
    >
      <TimeContext.Provider value={{ t, fps, width, height, mode }}>
        <TunnelProvider>{children}</TunnelProvider>
      </TimeContext.Provider>
    </div>
  );

  if (mode === 'export') return surface;
  return (
    <div
      ref={host}
      style={{ position: 'relative', width: '100%', aspectRatio: `${width} / ${height}`, overflow: 'hidden' }}
    >
      <div style={{ position: 'absolute', left: 0, top: 0 }}>{surface}</div>
    </div>
  );
}

/** A player bound to React: re-renders on every time change. */
export function usePlayer(duration: number): [PlayerState, Player] {
  const [player] = useState(() => createPlayer(duration));
  useEffect(() => player.setDuration(duration), [player, duration]);
  useEffect(() => () => player.dispose(), [player]);
  const state = useSyncExternalStore(player.subscribe, player.get, player.get);
  return [state, player];
}

/**
 * A player that doesn't re-render its owner as time passes (screens with a lot of UI): read
 * the time where it's drawn with usePlayerValue or <Timed>, and in handlers with player.get().
 */
export function usePlayerController(duration: number): Player {
  const [player] = useState(() => createPlayer(duration));
  useEffect(() => player.setDuration(duration), [player, duration]);
  useEffect(() => () => player.dispose(), [player]);
  return player;
}

/** One value derived from the player; re-renders only when it changes (compared with Object.is). */
export function usePlayerValue<T>(player: Player, select: (s: PlayerState) => T): T {
  const read = () => select(player.get());
  return useSyncExternalStore(player.subscribe, read, read);
}

/** Renders `children(t)` on every time change, without re-rendering anything around it. */
export function Timed({ player, children }: { player: Player; children: (t: number) => ReactNode }) {
  return <>{children(usePlayerValue(player, (s) => s.t))}</>;
}
