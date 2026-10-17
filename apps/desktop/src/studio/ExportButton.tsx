import { useEffect, useState } from 'react';
import type { ExportState } from '@studio/core';
import { Button } from '@studio/ui';
import { useEngine } from '../engine';

/**
 * The Studio header's export control: starts an export of the saved timeline, shows its
 * progress with a Cancel, then offers Reveal in Finder. (The Export screen arrives in 7.6.)
 */
export function ExportButton({ slug }: { slug: string }) {
  const { client } = useEngine();
  const [job, setJob] = useState<ExportState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client) return;
    let live = true;
    void client.call('export.status', { slug }).then(
      (s) => live && setJob(s),
      () => {},
    );
    const off = client.on('export.progress', (s) => s.slug === slug && setJob(s));
    return () => {
      live = false;
      off();
    };
  }, [client, slug]);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    fn().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };

  if (job?.state === 'running') {
    const pct = Math.floor(job.progress * 100);
    return (
      <Button
        onClick={() => client && run(() => client.call('export.cancel', { slug }))}
        title={`${job.phase === 'render' ? `Rendering frame ${job.frames} of ${job.total}` : job.phase}: click to cancel`}
        aria-label={`Exporting, ${pct} percent. Cancel export`}
        style={{
          backgroundImage: `linear-gradient(to right, var(--ui-gray-100) ${pct}%, transparent ${pct}%)`,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        Exporting {pct}% · Cancel
      </Button>
    );
  }
  const problem = error ?? (job?.state === 'failed' ? job.error : null);
  return (
    <>
      {problem && (
        <span
          role="alert"
          title={problem}
          style={{ color: 'var(--ui-red-ink)', fontSize: 12, maxWidth: 220 }}
        >
          Export failed: {problem.length > 60 ? `${problem.slice(0, 60)}…` : problem}
        </span>
      )}
      {job?.state === 'done' && job.file && (
        <Button
          onClick={() => client && run(() => client.call('project.reveal', { slug, path: job.file! }))}
          title={`${job.file}: exported in ${job.seconds?.toFixed(0) ?? '?'} s`}
        >
          Reveal in Finder
        </Button>
      )}
      <Button
        variant="primary"
        disabled={!client}
        onClick={() => client && run(() => client.call('export.start', { slug, fps: 30 }))}
        title="Render the tutorial to output/<slug>.mp4 (1080p30, voice-over at −16 LUFS)"
      >
        {job?.state === 'done' ? 'Export again' : 'Export'}
      </Button>
    </>
  );
}
