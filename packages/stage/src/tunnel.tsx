import {
  createContext,
  useContext,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

/**
 * Lets components rendered in the DOM tree (overlays) place content inside the stage's single
 * R3F canvas. `In` registers children under a stable key; `Out` (rendered inside <Scene3D>)
 * renders everything registered, in registration order.
 */
export interface Tunnel {
  set(key: string, node: ReactNode): void;
  remove(key: string): void;
  subscribe(fn: () => void): () => void;
  snapshot(): [string, ReactNode][];
}

export function createTunnel(): Tunnel {
  const nodes = new Map<string, ReactNode>();
  const listeners = new Set<() => void>();
  let snap: [string, ReactNode][] = [];
  const emit = () => {
    snap = [...nodes.entries()];
    listeners.forEach((fn) => fn());
  };
  return {
    set(key, node) {
      nodes.set(key, node);
      emit();
    },
    remove(key) {
      if (nodes.delete(key)) emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    snapshot: () => snap,
  };
}

const TunnelContext = createContext<Tunnel | null>(null);

export function TunnelProvider({ children }: { children: ReactNode }) {
  const [tunnel] = useState(createTunnel);
  return <TunnelContext.Provider value={tunnel}>{children}</TunnelContext.Provider>;
}

export const useTunnel = () => useContext(TunnelContext);

/** Sends children into the stage's 3D scene. Renders nothing where it is used. */
export function TunnelIn({ children }: { children: ReactNode }) {
  const tunnel = useTunnel();
  const key = useId();
  useEffect(() => {
    tunnel?.set(key, children);
  }, [tunnel, key, children]);
  useEffect(() => () => tunnel?.remove(key), [tunnel, key]);
  return null;
}

/** Renders everything sent through the tunnel (place inside <Scene3D>). */
export function TunnelOut() {
  const tunnel = useTunnel();
  const empty: [string, ReactNode][] = [];
  const nodes = useSyncExternalStore(
    tunnel?.subscribe ?? (() => () => {}),
    tunnel?.snapshot ?? (() => empty),
    tunnel?.snapshot ?? (() => empty),
  );
  return (
    <>
      {nodes.map(([key, node]) => (
        <group key={key}>{node}</group>
      ))}
    </>
  );
}
