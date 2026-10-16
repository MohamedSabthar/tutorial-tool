import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { rewriteSharedImports, startOverlayServer, type OverlayServer } from '../src/overlayServer';

describe('shared import rewriting', () => {
  it('maps default, named, aliased and namespace imports to the shared registry', async () => {
    const out = await rewriteSharedImports(
      [
        "import React, { useState as useS, useMemo } from 'react';",
        "import * as THREE from 'three';",
        "import { jsx as _jsx } from 'react/jsx-runtime';",
        "import { helper } from './helper';",
        'export default 1;',
      ].join('\n'),
      'X.tsx',
    );
    expect(out).toContain('globalThis.__STUDIO_SHARED__["react"]');
    expect(out).toMatch(/const React = __shared0\.default \?\? __shared0;/);
    expect(out).toContain('const { useState: useS, useMemo } = __shared0;');
    expect(out).toContain('const THREE = __shared1;');
    expect(out).toContain('const { jsx: _jsx } = __shared2;');
    expect(out).toContain("import { helper } from './helper';");
  });

  it('rejects packages that are not shared', async () => {
    await expect(rewriteSharedImports("import _ from 'lodash';", 'Bad.tsx')).rejects.toThrow(
      /may only import/,
    );
  });
});

describe('overlay server', () => {
  let ws: string;
  let server: OverlayServer;
  const changes: (string | null)[] = [];

  beforeAll(async () => {
    ws = await mkdtemp(path.join(os.tmpdir(), 'overlays-'));
    await mkdir(path.join(ws, 'projects', 'demo', 'overlays'), { recursive: true });
    await writeFile(
      path.join(ws, 'projects', 'demo', 'overlays', 'Hello.tsx'),
      "import { theme } from '@studio/overlay-sdk';\nexport const meta = { name: 'Hello' };\nexport default function Hello() { return <div style={{ color: theme.color.orange }}>hi</div>; }\n",
    );
    server = await startOverlayServer(ws, (c) => changes.push(c.id));
  });

  afterAll(async () => {
    await server.close();
    await rm(ws, { recursive: true, force: true });
  });

  it('lists project overlays with ids', async () => {
    const list = await server.list('demo');
    expect(list.map((e) => [e.id, e.path])).toEqual([['project:Hello', 'projects/demo/overlays/Hello.tsx']]);
  });

  it('compiles TSX with shared imports and CORS', async () => {
    const res = await fetch(`${server.url}/projects/demo/overlays/Hello.tsx`, {
      headers: { origin: 'tauri://localhost' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeTruthy();
    const js = await res.text();
    expect(js).toContain('__STUDIO_SHARED__');
    expect(js).not.toMatch(/from ["']@studio\/overlay-sdk["']/);
  });

  it('reports file changes with the overlay id', async () => {
    await writeFile(
      path.join(ws, 'projects', 'demo', 'overlays', 'Hello.tsx'),
      'export default function Hello() { return null; }\n',
    );
    for (let i = 0; i < 40 && !changes.includes('project:Hello'); i++)
      await new Promise((r) => setTimeout(r, 100));
    expect(changes).toContain('project:Hello');
  });
});
