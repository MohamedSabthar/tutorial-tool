/** A unified diff with added and removed lines tinted (file headers in bold). */
export function DiffView({ diff, maxHeight = 320 }: { diff: string; maxHeight?: number }) {
  const lines = diff.split('\n');
  return (
    <pre
      aria-label="Changes"
      className="ui-mono"
      style={{
        margin: 0,
        maxHeight,
        overflow: 'auto',
        fontSize: 11,
        lineHeight: 1.5,
        background: 'var(--ui-gray-50)',
        border: '1px solid var(--ui-gray-300)',
        borderRadius: 'var(--ui-radius-sm)',
        padding: 8,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {lines.map((l, i) => {
        const file = l.startsWith('diff --git') || l.startsWith('+++') || l.startsWith('---');
        const style: React.CSSProperties = file
          ? { fontWeight: 600, color: 'var(--ui-navy)' }
          : l.startsWith('+')
            ? { background: 'var(--ui-green-100)', color: 'var(--ui-green-ink)' }
            : l.startsWith('-')
              ? { background: 'var(--ui-red-100)', color: 'var(--ui-red-ink)' }
              : l.startsWith('@@')
                ? { color: 'var(--ui-steel)' }
                : { color: 'var(--ui-gray-600)' };
        if (l.startsWith('index ') || l.startsWith('new file mode')) return null;
        return (
          <div key={i} style={style}>
            {l || ' '}
          </div>
        );
      })}
    </pre>
  );
}
