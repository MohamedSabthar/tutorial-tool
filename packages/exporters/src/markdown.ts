/** One step of the written tutorial. */
export interface DocStep {
  title: string;
  instruction: string;
  /** Image path relative to the Markdown file, if there is a still. */
  image?: string;
}

export interface DocInput {
  title: string;
  /** A line or two under the title (the brief's goal). */
  intro?: string;
  /** The video and caption files next to the doc. */
  video?: string;
  captions?: string;
  steps: DocStep[];
}

/** Markdown-escapes text used inside link or image brackets. */
const bracket = (s: string) => s.replace(/[[\]\\]/g, '\\$&');
/** URL-encodes a relative path for a Markdown link (spaces etc.), keeping the slashes. */
const href = (p: string) => p.split('/').map(encodeURIComponent).join('/');

/** The written tutorial: title, intro, links to the video, then numbered steps with stills. */
export function renderMarkdown(doc: DocInput): string {
  const out = [`# ${doc.title.trim()}`, ''];
  if (doc.intro?.trim()) out.push(doc.intro.trim(), '');
  const links = [
    doc.video ? `[Watch the video](${href(doc.video)})` : '',
    doc.captions ? `[captions](${href(doc.captions)})` : '',
  ].filter(Boolean);
  if (links.length) out.push(links.join(' · '), '');
  doc.steps.forEach((s, i) => {
    out.push(`## ${i + 1}. ${s.title.trim()}`, '');
    if (s.instruction.trim()) out.push(s.instruction.trim(), '');
    if (s.image) out.push(`![${bracket(s.title.trim())}](${href(s.image)})`, '');
  });
  return out.join('\n');
}

/** README for script.spec.ts in the output folder. */
export function scriptReadme(slug: string): string {
  return [
    `# Re-recording "${slug}"`,
    '',
    '`script.spec.ts` is the Playwright script that drives VS Code through this tutorial. Tutorial Studio runs it to record each take.',
    '',
    'To record it again (for example after the product changed):',
    '',
    `1. Open the project "${slug}" in Tutorial Studio.`,
    '2. Choose **Re-record** in the Studio header, then run the script in record mode. A dry run first checks every step without saving a take.',
    '3. The new take replaces the old one in the timeline: steps, overlays and voice-over follow their steps, and timing is refit.',
    '4. Export again.',
    '',
    'The copy here is for reference: edit the script in the project (or ask the agent to), not in this folder.',
    '',
  ].join('\n');
}
