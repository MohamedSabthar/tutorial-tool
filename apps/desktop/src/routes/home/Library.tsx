import { Fragment, useState } from 'react';
import type { ProjectSummary, Series } from '@studio/core';
import {
  Button,
  Glyph,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  Sheet,
  Shell,
  ShellHeader,
  ShellPanel,
  StatusPill,
  useToast,
} from '@studio/ui';
import { useEngine } from '../../engine';
import { navigate } from '../frame';
import { seriesSummary, tileMeta, tileRoute, tileStatus } from './tutorialStatus';

type Item =
  { kind: 'one'; project: ProjectSummary; at: string } | { kind: 'series'; series: Series; at: string };

/** Single tutorials and series, newest first; a series' tutorials only show inside it. */
export function libraryItems(projects: readonly ProjectSummary[], series: readonly Series[]): Item[] {
  const bySeries = new Set(series.map((s) => s.slug));
  const items: Item[] = [];
  for (const s of series) {
    const dates = s.parts.flatMap((part) => projects.find((p) => p.slug === part.project)?.updatedAt ?? []);
    const at = [s.updatedAt, ...dates].sort().at(-1)!;
    items.push({ kind: 'series', series: s, at });
  }
  for (const p of projects)
    if (!p.series || !bySeries.has(p.series.slug)) items.push({ kind: 'one', project: p, at: p.updatedAt });
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

/** The engine URL of a poster (it needs the token). */
function useMedia() {
  const { info } = useEngine();
  return (rel: string | null) =>
    rel && info ? `http://127.0.0.1:${info.port}${rel}?token=${encodeURIComponent(info.token)}` : undefined;
}

function Thumb({
  src,
  children,
  stack = false,
}: {
  src?: string;
  children?: React.ReactNode;
  stack?: boolean;
}) {
  return (
    <span className={`hm-thumb${stack ? ' hm-stack' : ''}`}>
      <span className="hm-thumb-in">
        {src ? (
          <img src={src} alt="" loading="lazy" />
        ) : (
          <span className="hm-thumb-empty" aria-hidden="true">
            <Glyph name="film" size={22} />
          </span>
        )}
      </span>
      {children}
    </span>
  );
}

function Pill({ p }: { p: ProjectSummary }) {
  const st = tileStatus(p);
  return (
    <StatusPill tone={st.tone} icon={st.icon} busy={st.busy}>
      {st.label}
    </StatusPill>
  );
}

/** The tutorials grid on Home: tiles, series stacks that open into their episodes, and each tile's menu. */
export function Library({
  projects,
  series,
  loading,
}: {
  projects: ProjectSummary[];
  series: Series[];
  loading: boolean;
}) {
  const { client } = useEngine();
  const toast = useToast();
  const media = useMedia();
  const [open, setOpen] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ProjectSummary | null>(null);
  const [deleting, setDeleting] = useState(false);
  const items = libraryItems(projects, series);
  const err = (e: unknown) => toast(e instanceof Error ? e.message : String(e), { tone: 'error' });

  const addTo = async (p: ProjectSummary, s: Series) => {
    setMenu(null);
    if (!client) return;
    try {
      await client.call('series.addProject', { slug: s.slug, project: p.slug });
      setOpen(s.slug);
      toast(`Added to ${s.title} as episode ${s.parts.length + 1}. Its video is unchanged.`);
    } catch (e) {
      err(e);
    }
  };
  const newSeries = async (p: ProjectSummary) => {
    setMenu(null);
    if (!client) return;
    try {
      const s = await client.call('series.create', { topic: p.title, product: p.product });
      await client.call('series.addProject', { slug: s.slug, project: p.slug });
      setOpen(s.slug);
      toast('New series created. Add episodes from its outline.', {
        action: { label: 'Open outline', run: () => navigate(`/series/${s.slug}`) },
      });
    } catch (e) {
      err(e);
    }
  };
  const reveal = (p: ProjectSummary) => {
    setMenu(null);
    void client?.call('project.reveal', { slug: p.slug, path: 'project.json' }).catch(err);
  };
  const remove = async () => {
    if (!client || !confirm) return;
    setDeleting(true);
    try {
      await client.call('project.delete', { slug: confirm.slug });
      toast(`Deleted “${confirm.title}”.`);
      setConfirm(null);
    } catch (e) {
      err(e);
    } finally {
      setDeleting(false);
    }
  };

  const tileMenu = (p: ProjectSummary, inSeries: boolean) => {
    const key = `m:${p.slug}`;
    return (
      <div className="hm-more-wrap">
        <button
          type="button"
          className="ui-btn ui-btn-sm ui-icon-btn hm-more"
          aria-label={`More for ${p.title}`}
          aria-haspopup="menu"
          aria-expanded={menu === key}
          onClick={() => setMenu(menu === key ? null : key)}
        >
          <Glyph name="dots" size={14} />
        </button>
        <Popover open={menu === key} onClose={() => setMenu(null)} minWidth={260}>
          <Menu label={`${p.title} actions`}>
            {!inSeries && (
              <>
                <MenuLabel>Add to series</MenuLabel>
                {series
                  .filter((s) => s.outline !== 'planning')
                  .map((s) => (
                    <MenuItem
                      key={s.slug}
                      icon="film"
                      hint={`as episode ${s.parts.length + 1}`}
                      onSelect={() => void addTo(p, s)}
                    >
                      {s.title}
                    </MenuItem>
                  ))}
                <MenuItem icon="plus" onSelect={() => void newSeries(p)}>
                  New series starting with this
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <MenuItem icon="folder" onSelect={() => reveal(p)}>
              Show in Finder
            </MenuItem>
            <MenuItem
              icon="trash"
              onSelect={() => {
                setMenu(null);
                setConfirm(p);
              }}
            >
              Delete…
            </MenuItem>
          </Menu>
        </Popover>
      </div>
    );
  };

  const tile = (p: ProjectSummary, n?: number) => (
    <div className="hm-tile" key={p.slug}>
      <a className="hm-card" href={`#${tileRoute(p)}`}>
        <Thumb src={media(p.poster)}>{n !== undefined && <span className="hm-num">{n}</span>}</Thumb>
        <b>{p.title}</b>
        <span className="hm-meta">
          <Pill p={p} />
          <span>{tileMeta(p)}</span>
        </span>
      </a>
      {tileMenu(p, n !== undefined)}
    </div>
  );

  const seriesTile = (s: Series) => {
    const c = seriesSummary(s, projects);
    const first = s.parts.map((x) => projects.find((p) => p.slug === x.project)).find((p) => p?.poster);
    const isOpen = open === s.slug;
    const outline =
      s.outline === 'planning' ? (
        <StatusPill tone="brand" busy>
          Drafting the outline
        </StatusPill>
      ) : s.outline === 'review' ? (
        <StatusPill tone="warning" icon="warn">
          Your turn: approve the outline
        </StatusPill>
      ) : s.outline === 'draft' ? (
        <StatusPill icon="clock">Outline draft</StatusPill>
      ) : null;
    return (
      <Fragment key={s.slug}>
        <div className="hm-tile">
          <button
            type="button"
            className="hm-card"
            data-on={isOpen || undefined}
            aria-expanded={isOpen}
            aria-controls={`hm-ser-${s.slug}`}
            onClick={() => setOpen(isOpen ? null : s.slug)}
          >
            <Thumb src={media(first?.poster ?? null)} stack>
              <span className="hm-badge">
                <Glyph name="film" size={11} />
                {s.parts.length} episode{s.parts.length === 1 ? '' : 's'}
              </span>
            </Thumb>
            <b>{s.title}</b>
            <span className="hm-meta">
              {outline}
              {c.needs > 0 && <StatusPill tone="warning">{c.needs} need you</StatusPill>}
              {c.busy > 0 && <StatusPill tone="brand">{c.busy} in progress</StatusPill>}
              {c.ready > 0 && <StatusPill tone="positive">{c.ready} ready</StatusPill>}
              {c.failed > 0 && <StatusPill tone="negative">{c.failed} stopped or failed</StatusPill>}
              {s.outline === 'approved' && c.draft + c.unmade > 0 && (
                <StatusPill>{c.draft + c.unmade} not started</StatusPill>
              )}
            </span>
          </button>
        </div>
        {isOpen && (
          <div
            className="hm-exp k-enter"
            id={`hm-ser-${s.slug}`}
            role="region"
            aria-label={`${s.title} episodes`}
          >
            <div className="hm-exp-head">
              <StatusPill tone="brand" icon="film">
                Series
              </StatusPill>
              <b title={s.title}>{s.title}</b>
              <Button size="sm" onClick={() => navigate(`/series/${s.slug}?add=1`)}>
                <Glyph name="plus" size={12} />
                Add an episode
              </Button>
              <Button size="sm" variant="quiet" onClick={() => navigate(`/series/${s.slug}`)}>
                Edit outline
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  toast('Exporting a whole series comes later. For now, export each episode from its Studio.')
                }
              >
                <Glyph name="upload" size={12} />
                Export series
              </Button>
              <button
                type="button"
                className="ui-btn ui-btn-sm ui-btn-quiet ui-icon-btn"
                aria-label={`Close ${s.title}`}
                onClick={() => setOpen(null)}
              >
                <Glyph name="x" size={12} />
              </button>
            </div>
            <div className="hm-grid hm-grid-plain">
              {s.parts.map((part, i) => {
                const p = projects.find((x) => x.slug === part.project);
                if (p) return tile(p, i + 1);
                return (
                  <div className="hm-tile" key={part.id}>
                    <a className="hm-card" href={`#/series/${s.slug}`}>
                      <Thumb>
                        <span className="hm-num">{i + 1}</span>
                      </Thumb>
                      <b>{part.title}</b>
                      <span className="hm-meta">
                        <StatusPill icon="clock">In the outline</StatusPill>
                      </span>
                    </a>
                  </div>
                );
              })}
              {s.parts.length === 0 && (
                <p className="hm-note">No episodes yet. Edit the outline to add some.</p>
              )}
            </div>
          </div>
        )}
      </Fragment>
    );
  };

  return (
    <Shell className="hm-lib" aria-labelledby="hm-lib-h">
      <ShellHeader
        icon="film"
        title={<span id="hm-lib-h">Your tutorials</span>}
        subtitle="Each tutorial is its own project. A series groups them in order."
        aside={<span className="hm-count">{items.length || ''}</span>}
      />
      <ShellPanel className="hm-lib-panel">
        {loading ? (
          <p className="hm-note">Loading…</p>
        ) : items.length === 0 ? (
          <div className="hm-empty">
            <Glyph name="film" size={28} />
            <b>No tutorials yet</b>
            <span>Describe one above, or pick an example. It shows up here while it's made.</span>
          </div>
        ) : (
          <div className="hm-grid">
            {items.map((it) => (it.kind === 'series' ? seriesTile(it.series) : tile(it.project)))}
          </div>
        )}
      </ShellPanel>
      <Sheet
        open={!!confirm}
        onClose={() => !deleting && setConfirm(null)}
        title={`Delete “${confirm?.title ?? ''}”?`}
        subtitle="Its folder, recordings and voice-over are removed from the workspace. The workspace's history keeps a copy."
        width={460}
      >
        <div className="hm-sheet-actions">
          <Button onClick={() => setConfirm(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void remove()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </div>
      </Sheet>
    </Shell>
  );
}
