/**
 * The preview's floating tool rail. P and R annotate (a pin or a region at the current time);
 * T, Z and B add a TextLabel, Zoom or Blur by clicking or dragging on the preview; V selects.
 */
export type Tool = 'select' | 'pin' | 'region' | 'text' | 'zoom' | 'blur';

export const TOOLS: { tool: Tool; key: string; label: string }[] = [
  { tool: 'select', key: 'V', label: 'Select' },
  { tool: 'pin', key: 'P', label: 'Pin annotation' },
  { tool: 'region', key: 'R', label: 'Region annotation' },
  { tool: 'text', key: 'T', label: 'Text label' },
  { tool: 'zoom', key: 'Z', label: 'Zoom on an area' },
  { tool: 'blur', key: 'B', label: 'Blur an area' },
];

/** The tool for a key press (without modifiers), if any. */
export const toolForKey = (key: string): Tool | undefined =>
  TOOLS.find((t) => t.key === key.toUpperCase())?.tool;

export function ToolRail({ tool, onTool }: { tool: Tool; onTool: (t: Tool) => void }) {
  return (
    <div role="toolbar" aria-label="Preview tools" aria-orientation="vertical" className="tool-rail">
      {TOOLS.map((t) => (
        <button
          key={t.tool}
          type="button"
          className="tool-rail-btn"
          aria-label={`${t.label} (${t.key})`}
          title={`${t.label} (${t.key})`}
          aria-pressed={tool === t.tool}
          onClick={() => onTool(t.tool)}
        >
          {t.key}
        </button>
      ))}
    </div>
  );
}
