import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { listProducts } from '@studio/recorder/node';
import {
  BRIEF_AUDIENCES,
  BRIEF_LENGTHS,
  BRIEF_STYLES,
  BRIEF_WORKSPACES,
  type Brief,
  type Project,
  type SkillCoverage,
} from '@studio/core';

/**
 * The brief as the agent reads it: the Goal, Audience, Constraints and References sections of
 * the project's CLAUDE.md are rendered from brief.json. Other sections (Outline, Notes, anything
 * the agent added) are kept as they are.
 */
export function renderBrief(md: string, project: Project, brief: Brief): string {
  const label = <T extends readonly { value: string; text: string }[]>(list: T, v: string) =>
    list.find((o) => o.value === v)?.text ?? v;
  const constraints = [
    `- Starting workspace: ${label(BRIEF_WORKSPACES, brief.workspace)}`,
    brief.explainers
      ? '- Explainers: propose them where a concept is easier to show than to click through.'
      : "- Explainers: don't propose any; the user wants a recording only.",
    ...(brief.notes.trim() ? ['', brief.notes.trim()] : []),
  ].join('\n');
  const references = brief.references.length
    ? [
        'Read these while planning:',
        ...brief.references.map((r) => (r.kind === 'url' ? `- ${r.url}` : `- ${r.path}`)),
      ].join('\n')
    : 'None.';
  const withTitle = /^# .*$/m.test(md)
    ? md.replace(/^# .*$/m, `# ${project.title}`)
    : `# ${project.title}\n\n${md}`;
  return setSections(withTitle, {
    Goal: brief.goal.trim() || 'What the viewer should be able to do after watching.',
    Audience: [
      label(BRIEF_AUDIENCES, brief.audience),
      `- Length: ${label(BRIEF_LENGTHS, brief.length)}`,
      `- Style: ${label(BRIEF_STYLES, brief.style)}`,
    ].join('\n'),
    Constraints: constraints,
    References: references,
  });
}

/** Replaces the bodies of `## <name>` sections, inserting missing ones before "## Outline". */
export function setSections(md: string, sections: Record<string, string>): string {
  const lines = md.replace(/\s+$/, '').split('\n');
  const parts: { head: string | null; body: string[] }[] = [{ head: null, body: [] }];
  for (const line of lines) {
    if (/^## /.test(line)) parts.push({ head: line.slice(3).trim(), body: [] });
    else parts.at(-1)!.body.push(line);
  }
  for (const [name, body] of Object.entries(sections)) {
    const content = ['', ...body.split('\n'), ''];
    const existing = parts.find((p) => p.head === name);
    if (existing) {
      existing.body = content;
      continue;
    }
    const at = parts.findIndex((p) => p.head === 'Outline');
    parts.splice(at === -1 ? parts.length : at, 0, { head: name, body: content });
  }
  return (
    parts
      .map((p) => [...(p.head === null ? [] : [`## ${p.head}`]), ...p.body].join('\n'))
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  );
}

interface ProductEntry {
  id: string;
  name: string;
  skill?: string;
}

/** The products tutorials can be made for: the recorder's registry, with each one's skill. */
async function products(workspace: string): Promise<ProductEntry[]> {
  let entries: ProductEntry[] = [];
  try {
    const raw = JSON.parse(await readFile(path.join(workspace, 'products.json'), 'utf8')) as {
      products?: ProductEntry[];
    };
    entries = raw.products ?? [];
  } catch {
    // No products.json: the built-in products.
  }
  return listProducts().map((p) => ({
    id: p.id,
    name: p.name,
    skill: entries.find((e) => e.id === p.id)?.skill ?? p.skill ?? p.id,
  }));
}

const STOP = new Set(
  'the and with for from into that this then your you how use using add create make run try call its are was can will one new'.split(
    ' ',
  ),
);
const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );

/** The product skill's component notes, and which of them share words with the goal. */
export async function skillCoverage(
  workspace: string,
  product: string,
  goal: string,
): Promise<SkillCoverage> {
  const skill = (await products(workspace)).find((p) => p.id === product)?.skill ?? product;
  const dir = path.join(workspace, '.claude', 'skills', skill);
  let files: string[];
  try {
    await readdir(dir);
  } catch {
    return { product, skill: null, items: [] };
  }
  try {
    files = (await readdir(path.join(dir, 'components'))).filter((f) => f.endsWith('.md')).sort();
  } catch {
    files = [];
  }
  const goalWords = words(goal);
  const items = await Promise.all(
    files.map(async (f) => {
      const text = await readFile(path.join(dir, 'components', f), 'utf8');
      const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
      const field = (k: string) => new RegExp(`^${k}:\\s*(.+)$`, 'm').exec(front)?.[1]?.trim() ?? null;
      const name = field('component') ?? f.replace(/\.md$/, '');
      const title = /^# (.+)$/m.exec(text)?.[1]?.trim() ?? name;
      const headings = [...text.matchAll(/^#{1,3} (.+)$/gm)].map((m) => m[1]).join(' ');
      const own = words(`${name} ${title} ${headings}`);
      return {
        name,
        title,
        lastVerified: field('last_verified'),
        relevant: [...goalWords].some((w) => own.has(w)),
      };
    }),
  );
  return { product, skill, items };
}

const countFiles = async (dir: string, ext: RegExp) => {
  try {
    return (await readdir(dir, { recursive: true })).filter((f) => ext.test(String(f))).length;
  } catch {
    return 0;
  }
};

export async function knowledgeSummary(workspace: string) {
  const list = await products(workspace);
  const coverage = await Promise.all(list.map((p) => skillCoverage(workspace, p.id, '')));
  return {
    products: list.map((p, i) => ({ id: p.id, name: p.name, skill: coverage[i]!.skill })),
    productSkills: coverage.filter((c) => c.skill).length,
    components: coverage.reduce((n, c) => n + c.items.length, 0),
    overlays: await countFiles(path.join(workspace, 'overlays'), /\.tsx$/),
    scenes: await countFiles(path.join(workspace, 'scenes'), /\.tsx$/),
  };
}
