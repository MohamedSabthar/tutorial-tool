import { useEffect, useRef, useState } from 'react';
import type { Annotation } from '@studio/core';
import { Button } from '@studio/ui';

const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

/**
 * Edits one annotation next to its pin: the instruction, Save, Send to agent, Resolve/Reopen
 * and Delete. Enter with ⌘ saves, Escape closes (a new, empty annotation is discarded).
 */
export function AnnotationPopover({
  annotation,
  n,
  stepLabel,
  style,
  onSave,
  onSend,
  onResolve,
  onDelete,
  onClose,
}: {
  annotation: Annotation;
  /** Number shown on its pin. */
  n: number;
  /** e.g. "step 3", for the context line. */
  stepLabel: string | null;
  style: React.CSSProperties;
  onSave: (comment: string) => void;
  onSend?: (comment: string) => void;
  onResolve: (resolved: boolean) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const [text, setText] = useState(annotation.comment);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const resolved = annotation.status === 'resolved';
  const id = `annotation-${annotation.id}`;

  return (
    <div
      role="dialog"
      aria-label={`Annotation ${n}`}
      className="annotation-popover"
      style={style}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="annotation-popover-head">
        <span className="annotation-popover-title">Annotation {n}</span>
        <span className="ui-mono annotation-popover-time">@ {fmt(annotation.t)}</span>
      </div>
      <label htmlFor={id} className="ui-sr-only">
        Annotation text
      </label>
      <textarea
        id={id}
        ref={area}
        rows={3}
        className="annotation-popover-text"
        placeholder={
          annotation.shape.kind === 'point'
            ? 'What should change here? e.g. “Arrow pointing at Create”'
            : 'What should change in this area?'
        }
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSave(text.trim());
        }}
      />
      <span className="annotation-popover-context">
        Frame, {annotation.shape.kind === 'rect' ? 'region' : 'point'}
        {stepLabel ? ` and ${stepLabel}` : ''} context attached
      </span>
      <div className="annotation-popover-actions">
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onResolve(!resolved)}>
          {resolved ? 'Reopen' : 'Resolve'}
        </Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" disabled={!text.trim()} onClick={() => onSave(text.trim())}>
          Save
        </Button>
        {onSend && (
          <Button size="sm" variant="primary" disabled={!text.trim()} onClick={() => onSend(text.trim())}>
            Send to agent
          </Button>
        )}
      </div>
    </div>
  );
}
