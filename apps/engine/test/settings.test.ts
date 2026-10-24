import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { configureProducts } from '@studio/recorder/node';
import { ProjectStore } from '../src/projects';
import { ProductsRegistry } from '../src/productsFile';
import { secretStore } from '../src/secrets';

describe('settings', () => {
  let ws: string;
  beforeEach(async () => void (ws = await mkdtemp(path.join(os.tmpdir(), 'settings-'))));
  afterEach(async () => {
    configureProducts([]);
    await rm(ws, { recursive: true, force: true });
  });

  it('gives new briefs the default voice and auto mode', async () => {
    const store = new ProjectStore(ws);
    expect(await store.readSettings()).toEqual({
      defaultVoice: null,
      autoMode: true,
      maxCostPerRun: null,
      agentModel: 'balanced',
      customModels: { deep: 'claude-opus-5-5', writing: 'claude-sonnet-5-5' },
      maxRepairs: 1,
      claudeExecutable: null,
      claudeConfigDir: null,
    });
    await store.updateSettings({ defaultVoice: 'v1', autoMode: false, maxCostPerRun: 2.5 });
    const { slug } = await store.create({ title: 'A', product: 'wso2-integrator' });
    expect(await store.readBrief(slug)).toMatchObject({ voice: 'v1', autoMode: false });
    expect((await store.readSettings()).maxCostPerRun).toBe(2.5);
  });

  it('saves products.json, keeping fields the editor does not know, and validates', async () => {
    await writeFile(
      path.join(ws, 'products.json'),
      JSON.stringify({
        products: [
          {
            id: 'wso2-integrator',
            name: 'WSO2 Integrator',
            projectStructure: 'BI',
            skill: 'wso2-integrator',
          },
        ],
      }),
    );
    const reg = new ProductsRegistry(ws);
    await reg.load();
    expect(reg.list().find((p) => p.id === 'wso2-integrator')).toMatchObject({
      launch: 'app',
      builtIn: true,
    });

    const list = await reg.save([
      { id: 'wso2-integrator', name: 'WSO2 Integrator', app: '/Applications/Elsewhere.app' },
      { id: 'mi', name: 'Micro Integrator', extensions: ['WSO2.micro-integrator@3.0.0'], skill: 'mi' },
    ]);
    expect(list.find((p) => p.id === 'mi')).toMatchObject({ launch: 'vscode', skill: 'mi', builtIn: false });
    const saved = JSON.parse(await readFile(path.join(ws, 'products.json'), 'utf8')) as {
      products: Record<string, unknown>[];
    };
    expect(saved.products[0]).toMatchObject({ projectStructure: 'BI', app: '/Applications/Elsewhere.app' });

    await expect(reg.save([{ id: 'x', name: 'No launch' }])).rejects.toThrow(
      /app path or at least one extension/,
    );
    await expect(reg.save([{ id: 'Bad Id', name: 'B', extensions: ['a'] }])).rejects.toThrow(/lower case/);
  });

  it('keeps test engines out of the Keychain with STUDIO_NO_KEYCHAIN', async () => {
    const file = path.join(ws, 'secrets.json');
    const s = secretStore({ env: { STUDIO_NO_KEYCHAIN: '1', STUDIO_SECRETS_FILE: file } });
    await s.set('elevenlabs', 'k1');
    expect(await s.get('elevenlabs')).toEqual({ value: 'k1', source: 'file' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ elevenlabs: 'k1' });
  });
});
