import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react';
import { isTauri } from './engine';

/** The app's colour theme. "system" follows macOS; the video is always light. */
export type ThemePref = 'system' | 'light' | 'dark';

const KEY = 'studio.theme';
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

export function setThemePref(pref: ThemePref) {
  try {
    if (pref === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch {
    // Not saved: the theme still applies until the window reloads.
  }
  current = pref;
  notify();
}

let current = readTheme();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // Other windows (the Studio pop-outs) change the theme through storage events.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY && e.key !== null) return;
    current = readTheme();
    onChange();
  };
  const media = darkQuery();
  window.addEventListener('storage', onStorage);
  media.addEventListener('change', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
    media.removeEventListener('change', onChange);
  };
}

/** The saved preference ("system" until the user picks one). */
export function useThemePref(): ThemePref {
  return useSyncExternalStore(subscribe, () => current);
}

/**
 * Applies the theme to <html> and the native window. `enabled` is false on screens that
 * capture the video (the export renderer), which stay light whatever the preference.
 */
export function useApplyTheme(enabled: boolean) {
  const pref = useThemePref();
  const systemDark = useSyncExternalStore(subscribe, () => darkQuery().matches);
  const dark = enabled && (pref === 'dark' || (pref === 'system' && systemDark));
  // Before paint, so a dark window never flashes light.
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  }, [dark]);
  useEffect(() => {
    if (!isTauri() || !enabled) return;
    // The title bar follows the app: null hands it back to the system setting.
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTheme(pref === 'system' ? null : pref))
      .catch(() => undefined);
  }, [pref, enabled]);
}
