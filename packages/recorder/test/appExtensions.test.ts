import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ensureAppExtensions } from '../src/launch/vscode';

let root: string;
let executable: string;
let home: string;
let cache: string;

async function json(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'app-ext-'));
  const app = path.join(root, 'Builder.app', 'Contents', 'Resources', 'app');
  executable = path.join(root, 'Builder.app', 'Contents', 'MacOS', 'Builder');
  home = path.join(root, 'home');
  cache = path.join(root, 'cache');
  await json(path.join(app, 'product.json'), {
    dataFolderName: '.builder',
    builtInExtensions: [{ name: 'wso2.bundled' }, { name: 'wso2.ui' }],
  });
  await json(path.join(app, 'extensions', 'bundled', 'package.json'), { publisher: 'wso2', name: 'bundled' });
  const ext = path.join(home, '.builder', 'extensions');
  await json(path.join(ext, 'wso2.ui-1.0.0', 'package.json'), { publisher: 'wso2', name: 'ui' });
  await json(path.join(ext, 'other.extra-2.0.0', 'package.json'), { publisher: 'other', name: 'extra' });
  await json(path.join(ext, 'extensions.json'), [
    { identifier: { id: 'wso2.ui' }, version: '1.0.0', relativeLocation: 'wso2.ui-1.0.0' },
    { identifier: { id: 'other.extra' }, version: '2.0.0', relativeLocation: 'other.extra-2.0.0' },
  ]);
});

afterEach(() => rm(root, { recursive: true, force: true }));

describe('ensureAppExtensions', () => {
  it("copies only the built-in extensions the app doesn't bundle, from the app's own folder", async () => {
    const dir = await ensureAppExtensions(executable, cache, () => {}, home);
    expect(existsSync(path.join(dir, 'wso2.ui-1.0.0', 'package.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'other.extra-2.0.0'))).toBe(false);
    const manifest = JSON.parse(await readFile(path.join(dir, 'extensions.json'), 'utf8')) as {
      identifier: { id: string };
      location: { path: string };
    }[];
    expect(manifest.map((e) => [e.identifier.id, e.location.path])).toEqual([
      ['wso2.ui', path.join(dir, 'wso2.ui-1.0.0')],
    ]);
  });

  it('names the missing extension when the app has never had it installed', async () => {
    await rm(path.join(home, '.builder'), { recursive: true });
    await expect(ensureAppExtensions(executable, cache, () => {}, home)).rejects.toThrow(/needs wso2\.ui/);
  });
});
