import { useCallback, useEffect, useRef, useState } from 'react';
import { describeAction, needsReview, type CaptureAction, type CaptureStatus } from '@studio/core';
import { Button, Chip, Panel, Title } from '@studio/ui';
import { useEngine } from '../../engine';
import { AppFrame, navigate } from '../frame';

const time = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

/** Hovers and scrolls are often incidental: shown quieter, for the agent to judge. */
const INCIDENTAL = new Set<CaptureAction['kind']>(['hover', 'scroll']);

function ActionRow({
  a,
  index,
  shotUrl,
  onRemove,
}: {
  a: CaptureAction;
  index: number;
  /** The marked shot (target boxed, pointer dotted), when it's ready. */
  shotUrl: string | null;
  onRemove: (() => void) | null;
}) {
  const best = 'locators' in a ? a.locators[0] : undefined;
  return (
    <li className="capture-action" data-incidental={INCIDENTAL.has(a.kind) ? 'true' : undefined}>
      <span className="capture-action-n ui-mono">{index + 1}</span>
      {shotUrl ? (
        <a
          className="capture-thumb"
          href={shotUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open the screen before step ${index + 1}, with its target marked`}
        >
          <img src={shotUrl} alt="" loading="lazy" />
        </a>
      ) : (
        <span className="capture-thumb" aria-hidden="true" />
      )}
      <span className="capture-action-main">
        <span className="capture-action-text">{describeAction(a)}</span>
        {best && (
          <span className="capture-action-code ui-mono" title="The locator the draft script uses">
            {'frame' in a && a.frame === 'webview' ? 'webview().' : 'page.'}
            {best.code}
          </span>
        )}
      </span>
      <span className="capture-action-meta">
        {'frame' in a && a.frame === 'webview' && <Chip tone="info">webview</Chip>}
        {best && best.count > 1 && (
          <Chip
            tone="active"
            title={`This locator matched ${best.count} elements; the agent will make it unique.`}
          >
            {best.count} matches
          </Chip>
        )}
        {'locators' in a && !best && <Chip tone="active">no locator</Chip>}
        {needsReview(a) && (best?.count ?? 0) <= 1 && 'locators' in a && !INCIDENTAL.has(a.kind) && (
          <Chip title="The agent checks this one against its marked shot.">review</Chip>
        )}
        <span className="ui-mono capture-action-t">{time(a.t)}</span>
        {onRemove && (
          <button
            type="button"
            className="capture-remove"
            aria-label={`Remove step ${index + 1}`}
            onClick={onRemove}
          >
            ×
          </button>
        )}
      </span>
    </li>
  );
}

/**
 * Feed mode: the product opens on the project's fixture and the user clicks through the
 * tutorial; each action appears here as it's captured. Finish saves the capture and a draft
 * script generated from it.
 */
export function CaptureScreen({ slug }: { slug: string }) {
  const { client, state: conn, info } = useEngine();
  const shotUrl = (a: CaptureAction) =>
    info && a.shot
      ? `http://127.0.0.1:${info.port}/media/${slug}/.studio/capture/shots/${a.shot}?token=${encodeURIComponent(info.token)}`
      : null;
  const [status, setStatus] = useState<CaptureStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const started = useRef(false);
  const list = useRef<HTMLOListElement>(null);

  const run = useCallback(async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, []);

  const start = useCallback(
    () =>
      run('start', async () => {
        if (!client) return;
        setSaved(null);
        setStatus(await client.call('capture.start', { slug }));
      }),
    [client, run, slug],
  );

  useEffect(() => {
    if (!client || conn !== 'open') return;
    const off = client.on('capture.changed', (s) => {
      if (s.slug === slug) setStatus(s);
    });
    void client.call('capture.get', { slug }).then((s) => {
      setStatus(s);
      // Opened from the brief's "Demo it": start right away, unless a capture is already saved.
      if (s.state === 'idle' && s.actions.length === 0 && !started.current) {
        started.current = true;
        void start();
      }
    });
    return off;
  }, [client, conn, slug, start]);

  const count = status?.actions.length ?? 0;
  useEffect(() => {
    list.current?.lastElementChild?.scrollIntoView({ block: 'nearest' });
  }, [count]);

  const open = status?.state === 'capturing' || status?.state === 'ended';
  /** A demo saved earlier: steps can be made from it without capturing again. */
  const savedDemo = status?.state === 'idle' && count > 0;
  const remove = (id: string) =>
    void run('remove', async () => {
      setStatus(await client!.call('capture.remove', { slug, ids: [id] }));
    });
  // Saves the capture (unless it's a saved one), then the agent turns it into steps and a
  // script; the storyboard shows it.
  const finish = () =>
    void run('finish', async () => {
      if (!savedDemo) {
        const r = await client!.call('capture.finish', { slug });
        setStatus(r.status);
        setSaved(r.scriptPath);
      }
      const brief = await client!.call('brief.get', { slug });
      await client!.call('pipeline.start', {
        slug,
        entry: 'from_capture',
        gates: { storyboard: brief.gates.storyboard, narration: brief.gates.narration },
      });
      navigate(`/storyboard/${slug}`);
    });
  // Closes an open capture without saving; a saved demo stays as it is.
  const cancel = () =>
    void run('cancel', async () => {
      if (open || status?.state === 'launching') await client!.call('capture.discard', { slug });
      navigate(`/brief/${slug}`);
    });

  return (
    <AppFrame
      current="projects"
      slug={slug}
      project="brief"
      footer={
        <>
          {error && (
            <span role="alert" className="app-error" style={{ marginRight: 'auto' }}>
              {error}
            </span>
          )}
          <Button size="lg" variant="ghost" disabled={!!busy} onClick={cancel}>
            Cancel
          </Button>
          <Button size="lg" disabled={!!busy || status?.state === 'launching'} onClick={() => void start()}>
            {busy === 'start' ? 'Opening…' : 'Start over'}
          </Button>
          <Button
            size="lg"
            variant="primary"
            disabled={!!busy || !(open || savedDemo) || count === 0}
            onClick={finish}
          >
            {busy === 'finish'
              ? 'Saving…'
              : savedDemo
                ? 'Make steps from this demo'
                : 'Finish and make steps'}
          </Button>
        </>
      }
    >
      <div className="brief capture">
        <div className="brief-form capture-main">
          <Title size={30} dot={false}>
            Demo the tutorial
          </Title>
          <p className="capture-status" role="status">
            {status?.state === 'launching' && <Chip tone="info">Opening</Chip>}
            {status?.state === 'capturing' && <Chip tone="ok">Capturing</Chip>}
            {status?.state === 'ended' && <Chip>Window closed</Chip>}
            <span>
              {saved
                ? `Saved ${count} action${count === 1 ? '' : 's'} and a draft script.`
                : savedDemo && !status.message
                  ? `A saved demo of ${count} action${count === 1 ? '' : 's'}. Make steps from it, remove what you don't want, or Start over to demo again.`
                  : (status?.message ?? (conn === 'open' ? 'Loading…' : 'Waiting for the engine…'))}
            </span>
          </p>
          {saved && (
            <div className="capture-saved">
              <span className="ui-mono">{saved}</span>
              <Button
                size="sm"
                onClick={() => void client?.call('project.reveal', { slug, path: saved }).catch(() => {})}
              >
                Show in Finder
              </Button>
            </div>
          )}
          {count === 0 ? (
            <p className="capture-empty">
              {status?.state === 'capturing'
                ? 'Your clicks, typing and shortcuts appear here as you make them.'
                : 'Nothing captured yet.'}
            </p>
          ) : (
            <ol className="capture-list" ref={list} aria-label="Captured actions">
              {status!.actions.map((a, i) => (
                <ActionRow
                  key={a.id}
                  a={a}
                  index={i}
                  shotUrl={shotUrl(a)}
                  onRemove={(open || savedDemo) && !busy ? () => remove(a.id) : null}
                />
              ))}
            </ol>
          )}
        </div>
        <aside className="brief-side">
          <Panel title="How it works" tone="dark">
            <ol className="brief-next">
              <li>The product opens on the tutorial&rsquo;s starting project.</li>
              <li>
                Click through the tutorial once, at any pace. Leave out anything you don&rsquo;t want shown.
              </li>
              <li>
                Everything is captured: clicks, typing, keys, hovers, scrolls and drags. Each gets a picture
                of the screen just before it, with the target boxed and your pointer dotted.
              </li>
              <li>
                Remove misclicks here with ×. Hovers and scrolls are shown fainter; the agent keeps only those
                that matter.
              </li>
              <li>
                Press Finish. The agent splits your clicks into steps and tidies the script, without
                researching. Passwords are never captured.
              </li>
              <li>Then the dry run, narration, voice-over and recording, as usual.</li>
            </ol>
          </Panel>
        </aside>
      </div>
    </AppFrame>
  );
}
