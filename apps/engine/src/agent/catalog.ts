import { z } from 'zod';
import type { OverlayServer } from '../overlayServer';

export interface CatalogEntry {
  id: string;
  kind: 'overlay' | 'scene';
  scope: 'core' | 'workspace' | 'project';
  name: string;
  description: string;
  /** JSON Schema of the component's props (input side, so defaults are optional). */
  props: unknown;
  path?: string;
  /** Set when the component file could not be loaded. */
  error?: string;
}

export interface Catalog {
  entries: CatalogEntry[];
  /** zod schema per component id, for validating instance props. */
  schemas: Map<string, z.ZodType>;
}

interface Meta {
  name?: string;
  description?: string;
  kind?: 'overlay' | 'scene';
  props?: z.ZodType;
}

let shared: Promise<void> | null = null;

/**
 * Fills `globalThis.__STUDIO_SHARED__` in Node so workspace components compiled by the overlay
 * server import the same modules here as in the preview (see apps/desktop/src/studio/shared.ts).
 */
export function registerSharedModules(): Promise<void> {
  shared ??= (async () => {
    // One at a time: three.js's CJS entry breaks if it is required while its ESM build is
    // still loading through a parallel import().
    const modules: Record<string, unknown> = {};
    for (const [name, load] of [
      ['react', () => import('react')],
      ['react/jsx-runtime', () => import('react/jsx-runtime')],
      ['react/jsx-dev-runtime', () => import('react/jsx-dev-runtime')],
      ['react-dom', () => import('react-dom')],
      ['zod', () => import('zod')],
      ['gsap', () => import('gsap')],
      ['three', () => import('three')],
      ['@react-three/fiber', () => import('@react-three/fiber')],
      ['@studio/core', () => import('@studio/core')],
      ['@studio/stage', () => import('@studio/stage')],
      ['@studio/overlay-sdk', () => import('@studio/overlay-sdk')],
      ['@studio/overlays-core', () => import('@studio/overlays-core')],
    ] as const)
      modules[name] = await load();
    (globalThis as unknown as { __STUDIO_SHARED__: Record<string, unknown> }).__STUDIO_SHARED__ = modules;
  })().catch((e: unknown) => {
    shared = null;
    throw e;
  });
  return shared;
}

function propsSchema(meta: Meta): unknown {
  try {
    return z.toJSONSchema(meta.props as z.ZodType, { io: 'input', unrepresentable: 'any' });
  } catch {
    return null;
  }
}

/** Every component the project can use: core built-ins, then workspace and project files. */
export async function loadCatalog(server: OverlayServer, slug: string): Promise<Catalog> {
  await registerSharedModules();
  const { coreOverlays } = await import('@studio/overlays-core');
  const entries: CatalogEntry[] = [];
  const schemas = new Map<string, z.ZodType>();
  const add = (id: string, scope: CatalogEntry['scope'], meta: Meta, extra: Partial<CatalogEntry> = {}) => {
    entries.push({
      id,
      kind: meta.kind ?? 'overlay',
      scope,
      name: meta.name ?? id,
      description: meta.description ?? '',
      props: propsSchema(meta),
      ...extra,
    });
    if (meta.props) schemas.set(id, meta.props);
  };
  for (const [id, mod] of Object.entries(coreOverlays)) add(id, 'core', mod.meta as Meta);
  for (const f of await server.list(slug)) {
    try {
      const mod = await server.load(f.path);
      const meta = (mod.meta ?? {}) as Meta;
      add(f.id, f.scope, { kind: f.kind, ...meta }, { path: f.path });
    } catch (e) {
      entries.push({
        id: f.id,
        kind: f.kind,
        scope: f.scope,
        name: f.id.split(':')[1]!,
        description: '',
        props: null,
        path: f.path,
        error: e instanceof Error ? e.message.split('\n')[0]! : String(e),
      });
    }
  }
  return { entries, schemas };
}
