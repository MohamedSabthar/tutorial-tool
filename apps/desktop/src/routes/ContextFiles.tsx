import { useId, useRef, useState } from 'react';

/** Files read as context: Markdown and plain text. */
const ACCEPT = '.md,.markdown,.mdx,.txt,text/markdown,text/plain';

/** Adds text to existing context, separated by a blank line. */
export function appendContext(current: string, text: string): string {
  const a = current.trimEnd();
  const b = text.trim();
  return a ? (b ? `${a}\n\n${b}` : a) : b;
}

/**
 * "Add .md files": reads the chosen Markdown or text files in the window and hands their text
 * (in the order chosen) to `onText`, to add to a context or notes field.
 */
export function ContextFiles({ onText }: { onText: (text: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const [error, setError] = useState<string | null>(null);

  const read = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    try {
      const texts = await Promise.all([...files].map((f) => f.text()));
      onText(
        texts
          .map((t) => t.trim())
          .filter(Boolean)
          .join('\n\n'),
      );
    } catch (e) {
      setError(`Couldn't read the file: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (input.current) input.current.value = '';
    }
  };

  return (
    <div className="context-files">
      <input
        ref={input}
        id={id}
        type="file"
        accept={ACCEPT}
        multiple
        className="context-files-input"
        onChange={(e) => void read(e.target.files)}
      />
      <label htmlFor={id} className="context-files-btn">
        + Add .md files
      </label>
      {error && (
        <span role="alert" className="app-error">
          {error}
        </span>
      )}
    </div>
  );
}
