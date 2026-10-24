import { useCallback, useEffect, useState } from 'react';
import { isTauri } from '../engine';

/**
 * Full-screen preview. The screen shows only the preview while `full` is set; the window
 * itself goes full screen too (the native window in the app, the Fullscreen API in a
 * browser). Leaving full screen another way (the green button, the browser's Esc) clears it.
 */
export function useFullscreen(): [boolean, (on: boolean) => void] {
  const [full, setFull] = useState(false);

  const set = useCallback((on: boolean) => {
    setFull(on);
    if (isTauri()) {
      void import('@tauri-apps/api/window')
        .then(({ getCurrentWindow }) => getCurrentWindow().setFullscreen(on))
        .catch(() => undefined);
    } else if (on && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (!on && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!full) return;
    if (!isTauri()) {
      const onChange = () => {
        if (!document.fullscreenElement) setFull(false);
      };
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    }
    let stop: (() => void) | undefined;
    let gone = false;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const un = await win.onResized(async () => {
        if (!(await win.isFullscreen())) setFull(false);
      });
      if (gone) un();
      else stop = un;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [full]);

  // Leaving the Studio leaves full screen.
  useEffect(() => () => set(false), [set]);

  return [full, set];
}
