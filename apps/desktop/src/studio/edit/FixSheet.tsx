import { useEffect } from 'react';
import { Glyph, IconTile, Kbd, Sheet, type GlyphName } from '@studio/ui';
import { mmss } from './model';

export type FixKind = 'say' | 'arrow' | 'label' | 'blur' | 'pace' | 'hold' | 'cut' | 'zoom' | 'callout' | 'note' | 'ask';

/** Each choice and its letter: with the sheet open (F), the letter picks it. */
const OPTIONS: { k: FixKind; key: string; icon: GlyphName; title: string; d: string }[] = [
  { k: 'say', key: 'S', icon: 'mic', title: "Change what's said", d: 'Edit the words, then re-voice' },
  { k: 'arrow', key: 'A', icon: 'arrow', title: 'Point something out', d: 'Click it to add an arrow' },
  { k: 'label', key: 'T', icon: 'label', title: 'Add a label', d: 'A short line of text on screen' },
  { k: 'callout', key: 'C', icon: 'label', title: 'Add a callout', d: 'A note next to what you click' },
  { k: 'zoom', key: 'Z', icon: 'expand', title: 'Zoom in here', d: 'Drag over the area to zoom into' },
  { k: 'blur', key: 'H', icon: 'hide', title: 'Hide something', d: 'Blur a key, email or name' },
  { k: 'pace', key: 'P', icon: 'gauge', title: 'Too slow or not needed', d: 'Speed up or skip this step' },
  { k: 'hold', key: 'R', icon: 'pause', title: 'Hold this frame', d: 'Freeze the picture here for 2 s' },
  { k: 'cut', key: 'X', icon: 'trash', title: 'Cut a part out', d: 'From here to where you click on the timeline' },
  { k: 'note', key: 'N', icon: 'pin', title: 'Mark it for the agent', d: 'Click the spot, then describe it' },
];
const ASK_KEY = 'Q';

/**
 * The single-key shortcuts, for the whole Studio: a letter picks its option straight away while
 * watching, without opening this sheet. (L is taken by playback, so the label is T for text.)
 */
export const FIX_KEYS: Record<string, FixKind> = Object.fromEntries([
  ...OPTIONS.map((o) => [o.key, o.k] as const),
  [ASK_KEY, 'ask'] as const,
]);

/** "What do you want to fix at 0:24?": each choice jumps straight to the control for it. */
export function FixSheet({
  open,
  at,
  step,
  onClose,
  onPick,
}: {
  open: boolean;
  at: number;
  step: string | null;
  onClose: () => void;
  onPick: (k: FixKind) => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if ((e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const letter = e.key.toUpperCase();
      const k = letter === ASK_KEY ? 'ask' : OPTIONS.find((o) => o.key === letter)?.k;
      if (!k) return;
      e.preventDefault();
      e.stopPropagation();
      onPick(k);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onPick]);
  return (
    <Sheet open={open} onClose={onClose} title={`What do you want to fix at ${mmss(at)}?`} subtitle={step ?? undefined} width={560}>
      <div className="ed-fixgrid">
        {OPTIONS.map((o) => (
          <button key={o.k} type="button" className="ed-fix" aria-keyshortcuts={o.key} onClick={() => onPick(o.k)}>
            <IconTile icon={o.icon} />
            <span className="ed-grow">
              <b>{o.title}</b>
              <span className="ed-fix-d">{o.d}</span>
            </span>
            <Kbd>{o.key}</Kbd>
          </button>
        ))}
        <button type="button" className="ed-fix ed-fix-wide" aria-keyshortcuts={ASK_KEY} onClick={() => onPick('ask')}>
          <IconTile icon="spark" tone="brand" />
          <span className="ed-grow">
            <b>Something else: ask the agent</b>
            <span className="ed-fix-d">“Explain tools with a short animation before this step”</span>
          </span>
          <Kbd>{ASK_KEY}</Kbd>
        </button>
      </div>
      <p className="ed-muted ed-s12 ed-fix-tip">
        <Glyph name="help" size={12} /> Each letter works on its own while you watch, no need to open this list (<Kbd>F</Kbd>).
      </p>
    </Sheet>
  );
}
