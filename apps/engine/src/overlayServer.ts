import { readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { init, parse } from 'es-module-lexer';
import { createServer, type Plugin, type ViteDevServer } from 'vite';

/**
 * Serves overlay and scene components from the workspace to the preview, compiled on demand:
 *   <workspace>/overlays/<Name>.tsx                 → workspace:<Name>
 *   <workspace>/scenes/<Name>.tsx                   → workspace:<Name> (kind scene)
 *   <workspace>/projects/<slug>/overlays/<Name>.tsx → project:<Name>
 *
 * Overlays must share the app's React, three.js, GSAP and SDK instances, so imports of those
 * packages are rewritten to read from `globalThis.__STUDIO_SHARED__`, which the app fills in.
 * Any other bare import is rejected; relative imports between overlay files work normally.
 */
export const SHARED_MODULES = [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'zod',
  'gsap',
  'three',
  '@react-three/fiber',
  '@studio/overlay-sdk',
  '@studio/overlays-core',
  '@studio/stage',
  '@studio/core',
] as const;

export interface OverlayEntry {
  id: string;
  kind: 'overlay' | 'scene';
  scope: 'workspace' | 'project';
  /** Path relative to the workspace, as served (e.g. "projects/demo-http/overlays/Hello.tsx"). */
  path: string;
  mtime: number;
}

export interface OverlayServer {
  url: string;
  list(slug?: string): Promise<OverlayEntry[]>;
  close(): Promise<void>;
}

/** Rewrites `import … from 'react'` etc. into reads from the shared registry. */
export async function rewriteSharedImports(code: string, file: string): Promise<string> {
  await init;
  const [imports] = parse(code);
  let out = '';
  let last = 0;
  let n = 0;
  for (const imp of imports) {
    const spec = imp.n;
    if (!spec || imp.d !== -1) continue; // only static imports
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    if (!(SHARED_MODULES as readonly string[]).includes(spec)) {
      throw new Error(
        `${path.basename(file)} imports "${spec}". Overlays may only import ${SHARED_MODULES.join(', ')} and relative files.`,
      );
    }
    const stmt = code.slice(imp.ss, imp.se);
    const clause = /^import\s+([\s\S]*?)\s+from\s+['"][^'"]+['"]\s*;?$/.exec(stmt)?.[1];
    const local = `__shared${n++}`;
    let replacement = `const ${local} = globalThis.__STUDIO_SHARED__[${JSON.stringify(spec)}];`;
    if (clause !== undefined) {
      const typeOnly = /^type\s/.test(clause);
      if (typeOnly) replacement = '';
      else {
        // default, * as ns, { a, b as c }
        const ns = /\*\s+as\s+(\w+)/.exec(clause)?.[1];
        const named = /\{([\s\S]*?)\}/.exec(clause)?.[1];
        const def = /^(\w+)\s*(,|$)/.exec(clause.trim())?.[1];
        if (def && def !== 'type') replacement += ` const ${def} = ${local}.default ?? ${local};`;
        if (ns) replacement += ` const ${ns} = ${local};`;
        if (named) {
          const parts = named
            .split(',')
            .map((p) => p.trim())
            .filter((p) => p && !p.startsWith('type '))
            .map((p) => {
              const [a, b] = p.split(/\s+as\s+/);
              return b ? `${a}: ${b}` : a;
            });
          if (parts.length) replacement += ` const { ${parts.join(', ')} } = ${local};`;
        }
      }
    }
    out += code.slice(last, imp.ss) + replacement;
    last = imp.se;
  }
  return out + code.slice(last);
}

function sharedImportsPlugin(): Plugin {
  return {
    name: 'studio-shared-imports',
    enforce: 'post',
    async transform(code, id) {
      if (!/\.(t|j)sx?$/.test(id.split('?')[0]!)) return null;
      return { code: await rewriteSharedImports(code, id), map: null };
    },
  };
}

export async function startOverlayServer(
  workspaceDir: string,
  onChange: (entry: { id: string | null; path: string; event: 'add' | 'change' | 'unlink' }) => void,
): Promise<OverlayServer> {
  // Vite's file allow-list and its watcher report real paths (e.g. /private/var on macOS).
  const workspace = await realpath(workspaceDir);
  const vite: ViteDevServer = await createServer({
    root: workspace,
    configFile: false,
    logLevel: 'warn',
    clearScreen: false,
    appType: 'custom',
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: false,
      cors: true,
      hmr: false,
      fs: { allow: [workspace] },
      watch: {
        ignored: ['**/recordings/**', '**/audio/**', '**/output/**', '**/.git/**', '**/node_modules/**'],
      },
    },
    optimizeDeps: { noDiscovery: true, include: [] },
    esbuild: { jsx: 'automatic' },
    plugins: [sharedImportsPlugin()],
  });
  await vite.listen();
  const addr = vite.httpServer?.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;

  const idFor = (abs: string): string | null => {
    const rel = path.relative(workspace, abs).split(path.sep).join('/');
    const m = /^(?:(overlays|scenes)|projects\/[^/]+\/(overlays|scenes))\/([A-Za-z][A-Za-z0-9]*)\.tsx$/.exec(
      rel,
    );
    if (!m) return null;
    return `${rel.startsWith('projects/') ? 'project' : 'workspace'}:${m[3]}`;
  };
  const relevant = (abs: string) => /\/(overlays|scenes)\/[^/]+\.tsx?$/.test(abs.split(path.sep).join('/'));
  for (const event of ['add', 'change', 'unlink'] as const) {
    vite.watcher.on(event, (abs: string) => {
      if (!relevant(abs)) return;
      // Drop compiled modules so the next import gets the new code (including imported helpers).
      vite.moduleGraph.invalidateAll();
      onChange({ id: idFor(abs), path: path.relative(workspace, abs), event });
    });
  }

  async function scan(
    dir: string,
    scope: 'workspace' | 'project',
    kind: 'overlay' | 'scene',
  ): Promise<OverlayEntry[]> {
    const abs = path.join(workspace, dir);
    const names = await readdir(abs).catch(() => [] as string[]);
    const out: OverlayEntry[] = [];
    for (const name of names) {
      const m = /^([A-Za-z][A-Za-z0-9]*)\.tsx$/.exec(name);
      if (!m) continue;
      const st = await stat(path.join(abs, name));
      out.push({ id: `${scope}:${m[1]}`, kind, scope, path: `${dir}/${name}`, mtime: st.mtimeMs });
    }
    return out;
  }

  return {
    url: `http://127.0.0.1:${port}`,
    async list(slug?: string) {
      const all = [
        ...(await scan('overlays', 'workspace', 'overlay')),
        ...(await scan('scenes', 'workspace', 'scene')),
      ];
      if (slug)
        all.push(
          ...(await scan(`projects/${slug}/overlays`, 'project', 'overlay')),
          ...(await scan(`projects/${slug}/scenes`, 'project', 'scene')),
        );
      return all;
    },
    close: () => vite.close(),
  };
}
