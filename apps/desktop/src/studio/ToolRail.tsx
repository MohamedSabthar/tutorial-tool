/**
 * The preview's floating tool rail. P and R annotate (a pin or a region at the current time);
 * T, Z and B add a TextLabel, Zoom or Blur by clicking or dragging on the preview; V selects.
 * Each tool is an icon; hovering or focusing it shows its name and key. The rail folds away
 * behind a ‹ button (the keys still work) and comes back with ›.
 */
import type { ComponentType } from 'react';
import { IconBlur, IconChevron, IconPin, IconPointer, IconRegion, IconText, IconZoom } from '@studio/ui';

export type Tool = 'select' | 'pin' | 'region' | 'text' | 'zoom' | 'blur';

export const TOOLS: { tool: Tool; key: string; label: string; Icon: ComponentType<{ size?: number }> }[] = [
  { tool: 'select', key: 'V', label: 'Select', Icon: IconPointer },
  { tool: 'pin', key: 'P', label: 'Pin annotation', Icon: IconPin },
  { tool: 'region', key: 'R', label: 'Region annotation', Icon: IconRegion },
  { tool: 'text', key: 'T', label: 'Text label', Icon: IconText },
  { tool: 'zoom', key: 'Z', label: 'Zoom on an area', Icon: IconZoom },
  { tool: 'blur', key: 'B', label: 'Blur an area', Icon: IconBlur },
];

/** The tool for a key press (without modifiers), if any. */
export const toolForKey = (key: string): Tool | undefined =>
  TOOLS.find((t) => t.key === key.toUpperCase())?.tool;

export function ToolRail({
  tool,
  onTool,
  shown,
  onShown,
}: {
  tool: Tool;
  onTool: (t: Tool) => void;
  shown: boolean;
  onShown: (shown: boolean) => void;
}) {
  const toggle = (
    <button
      type="button"
      className="tool-rail-btn tool-rail-toggle"
      aria-label={shown ? 'Hide preview tools' : 'Show preview tools'}
      aria-expanded={shown}
      onClick={() => onShown(!shown)}
    >
      <IconChevron size={14} style={shown ? { transform: 'scaleX(-1)' } : undefined} />
      <span className="tool-rail-tip" aria-hidden="true">
        {shown ? 'Hide tools (keys still work)' : 'Show tools'}
      </span>
    </button>
  );
  if (!shown) return <div className="tool-rail">{toggle}</div>;
  return (
    <div role="toolbar" aria-label="Preview tools" aria-orientation="vertical" className="tool-rail">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className="tool-rail-btn"
          aria-label={t.label}
          aria-keyshortcuts={t.key}
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        >
          <t.Icon size={15} />
          <span className="tool-rail-tip" aria-hidden="true">
            {t.label}
            <kbd>{t.key}</kbd>
          </span>
        </button>
      ))}
      {toggle}
    </div>
  );
}
