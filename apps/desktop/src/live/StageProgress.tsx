import { useRef, useState } from 'react';
import type { PipelineProgress } from '@studio/core';
import { Button, Title } from '@studio/ui';
import { useEngine } from '../engine';

const MARK: Record<PipelineProgress['items'][number]['state'], string> = {
  pending: '○',
  active: '●',
  done: '✓',
  failed: '✗',
};

/**
 * What a stage without a live window is working through, item by item: the voice-over's lines
 * as they're voiced (each playable once done), or post-production's steps.
 */
export function StageProgress({ progress }: { progress: PipelineProgress }) {
  const { info } = useEngine();
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const url = (rel: string) =>
    info
      ? `http://127.0.0.1:${info.port}/media/${progress.slug}/${rel}?token=${encodeURIComponent(info.token)}${progress.version ? `&v=${progress.version}` : ''}`
      : null;

  const play = (id: string, rel: string) => {
    const src = url(rel);
    if (!src) return;
    audio.current?.pause();
    if (playing === id) {
      setPlaying(null);
      return;
    }
    const a = new Audio(src);
    a.onended = () => setPlaying((p) => (p === id ? null : p));
    audio.current = a;
    setPlaying(id);
    void a.play().catch(() => setPlaying(null));
  };

  return (
    <div className="stage-progress">
      <Title size={22} rule={false}>
        {progress.message}
      </Title>
      <ol className="stage-progress-list">
        {progress.items.map((it) => (
          <li key={it.id} className="stage-progress-item" data-state={it.state}>
            <span className="stage-progress-mark" aria-hidden="true">
              {MARK[it.state]}
            </span>
            <span className="stage-progress-label">{it.label}</span>
            <span className="stage-progress-detail ui-mono">{it.detail}</span>
            {it.audio && it.state === 'done' && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${playing === it.id ? 'Stop' : 'Play'} ${it.label}`}
                onClick={() => play(it.id, it.audio!)}
              >
                {playing === it.id ? '■ Stop' : '▶ Play'}
              </Button>
            )}
            {it.image && url(it.image) && (
              <img className="stage-progress-image" src={url(it.image)!} alt={`${it.label}: screenshot`} />
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
