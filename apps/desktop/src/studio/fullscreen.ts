import { useCallback, useEffect, useRef, useState } from 'react';
import { isTauri } from '../engine';

/**
 * Full-screen preview. The screen shows only the preview while `full` is set; the window
 * itself goes full screen too (the native window in the app, the Fullscreen API in a
 * browser). Leaving full screen another way (the green button, the browser's Esc) clears it.
 *
 * The window only leaves full screen if this hook put it there: a window the user made full
 * screen (the green button) stays full screen when the preview or the Studio closes.
 */
export function useFullscreen(): [boolean, (on: boolean) => void] {
  const [full, setFull] = useState(false);
  // Whether this hook made the window (or document) full screen and so should undo it.
  const owns = useRef(false);

  const set = useCallback((on: boolean) => {
    setFull(on);
    if (isTauri()) {
      void import('@tauri-apps/api/window')
        .then(async ({ getCurrentWindow }) => {
          const win = getCurrentWindow();
          if (on) {
            if (await win.isFullscreen()) return;
            owns.current = true;
            await win.setFullscreen(true);
          } else if (owns.current) {
            owns.current = false;
            await win.setFullscreen(false);
          }
        })
        .catch(() => undefined);
    } else if (on && !document.fullscreenElement) {
      owns.current = true;
      void document.documentElement.requestFullscreen?.().catch(() => undefined);
    } else if (!on && owns.current) {
      owns.current = false;
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (!full) return;
    if (!isTauri()) {
      const onChange = () => {
        if (!document.fullscreenElement) {
          owns.current = false;
          setFull(false);
        }
      };
      document.addEventListener('fullscreenchange', onChange);
      return () => document.removeEventListener('fullscreenchange', onChange);
    }
    let stop: (() => void) | undefined;
    let gone = false;
    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow();
      const un = await win.onResized(async () => {
        if (!(await win.isFullscreen())) {
          owns.current = false;
          setFull(false);
        }
      });
      if (gone) un();
      else stop = un;
    });
    return () => {
      gone = true;
      stop?.();
    };
  }, [full]);

  // Leaving the Studio leaves a full screen it entered (never one the user chose).
  useEffect(
    () => () => {
      if (owns.current) set(false);
    },
    [set],
  );

  return [full, set];
}
