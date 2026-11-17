import { Glyph, IconTile, Kbd, Sheet, type GlyphName } from '@studio/ui';
import { mmss } from './model';

export type FixKind = 'say' | 'arrow' | 'label' | 'blur' | 'pace' | 'hold' | 'cut' | 'zoom' | 'callout' | 'note' | 'ask';

const OPTIONS: { k: FixKind; icon: GlyphName; title: string; d: string }[] = [
  { k: 'say', icon: 'mic', title: "Change what's said", d: 'Edit the words, then re-voice' },
  { k: 'arrow', icon: 'arrow', title: 'Point something out', d: 'Click it to add an arrow' },
  { k: 'label', icon: 'label', title: 'Add a label', d: 'A short line of text on screen' },
  { k: 'callout', icon: 'label', title: 'Add a callout', d: 'A note next to what you click' },
  { k: 'zoom', icon: 'expand', title: 'Zoom in here', d: 'Drag over the area to zoom into' },
  { k: 'blur', icon: 'hide', title: 'Hide something', d: 'Blur a key, email or name' },
  { k: 'pace', icon: 'gauge', title: 'Too slow or not needed', d: 'Speed up or skip this step' },
  { k: 'hold', icon: 'pause', title: 'Hold this frame', d: 'Freeze the picture here for 2 s' },
  { k: 'cut', icon: 'trash', title: 'Cut a part out', d: 'From here to where you click on the timeline' },
  { k: 'note', icon: 'pin', title: 'Mark it for the agent', d: 'Click the spot, then describe it' },
];

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
  return (
    <Sheet open={open} onClose={onClose} title={`What do you want to fix at ${mmss(at)}?`} subtitle={step ?? undefined} width={540}>
      <div className="ed-fixgrid">
        {OPTIONS.map((o) => (
          <button key={o.k} type="button" className="ed-fix" onClick={() => onPick(o.k)}>
            <IconTile icon={o.icon} />
            <span>
              <b>{o.title}</b>
              <span className="ed-fix-d">{o.d}</span>
            </span>
          </button>
        ))}
        <button type="button" className="ed-fix ed-fix-wide" onClick={() => onPick('ask')}>
          <IconTile icon="spark" tone="brand" />
          <span>
            <b>Something else: ask the agent</b>
            <span className="ed-fix-d">“Explain tools with a short animation before this step”</span>
          </span>
        </button>
      </div>
      <p className="ed-muted ed-s12 ed-fix-tip">
        <Glyph name="help" size={12} /> Tip: press <Kbd>F</Kbd> any time while watching.
      </p>
    </Sheet>
  );
}
