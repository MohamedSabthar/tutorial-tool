import { useEffect, useState } from 'react';
import type { ExportState } from '@studio/core';
import { LinkButton } from '@studio/ui';
import { useEngine } from '../engine';

/** The Studio header's Export button: opens the Export screen, showing progress while one runs. */
export function ExportButton({ slug }: { slug: string }) {
  const { client } = useEngine();
  const [job, setJob] = useState<ExportState | null>(null);

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

  const running = job?.state === 'running';
  const pct = running ? Math.floor(job.progress * 100) : 0;
  return (
    <LinkButton
      variant={running ? 'secondary' : 'primary'}
      href={`#/export/${slug}`}
      title="Export the video, captions, Markdown doc and script"
      style={running ? { fontVariantNumeric: 'tabular-nums' } : undefined}
    >
      {running ? `Exporting ${pct}%` : 'Export'}
    </LinkButton>
  );
}
