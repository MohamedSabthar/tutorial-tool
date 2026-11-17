import { useEffect, useRef } from 'react';
import type { PipelineState } from '@studio/core';
import { notifySystem, useToast } from '@studio/ui';
import { useEngine } from '../engine';
import { navigate, runRoute } from './frame';

/** What a run that just changed needs from the user, in their words; null when nothing to say. */
export function runNotice(st: PipelineState): { text: string; tone?: 'error' } | null {
  if (st.status === 'waiting' && st.gate) {
    const k = st.gate.kind;
    return {
      text:
        k === 'narration'
          ? 'Your turn: check the script'
          : k === 'storyboard'
            ? 'Your turn: check the steps'
            : k === 'cues'
              ? 'Some clicks land late: choose how to fix them'
              : k === 'knowledge'
                ? 'Review what the agent learned'
                : 'The agent needs your help',
    };
  }
  if (st.status === 'done') return { text: 'Ready to watch and edit' };
  if (st.status === 'failed') return { text: 'Stopped with a problem. Open it to see what happened', tone: 'error' };
  return null;
}

/**
 * Tells the user when any tutorial's run needs them, finishes or fails: a toast in the window,
 * and a system notification when the window is in the background. Mounted once per window.
 */
export function RunNotifier() {
  const { client, state } = useEngine();
  const toast = useToast();
  const seen = useRef(new Map<string, string>());
  const titles = useRef(new Map<string, string>());

  useEffect(() => {
    if (!client || state !== 'open') return;
    const refresh = () =>
      void client.call('project.list', {}).then(
        (list) => list.forEach((p) => titles.current.set(p.slug, p.title)),
        () => undefined,
      );
    refresh();
    return client.on('pipeline.changed', (st) => {
      const key = `${st.runId}:${st.status}:${st.gate?.kind ?? ''}:${st.stage ?? ''}`;
      const notice = runNotice(st);
      const before = seen.current.get(st.slug);
      seen.current.set(st.slug, key);
      // First sight of a run (window just opened) or no change worth telling: stay quiet.
      if (!notice || before === undefined || before === key) return;
      const title = titles.current.get(st.slug) ?? st.slug;
      if (!titles.current.has(st.slug)) refresh();
      notifySystem(title, notice.text);
      toast(
        <>
          <b style={{ fontWeight: 600 }}>{title}</b> · {notice.text}
        </>,
        { tone: notice.tone, action: { label: 'Open', run: () => navigate(runRoute(st.slug, st.status)) } },
      );
    });
  }, [client, state, toast]);

  return null;
}
