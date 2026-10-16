import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createBIProject, sanitizePackageName } from '../src/fixtures/biProject';

const dirs: string[] = [];
afterAll(async () => Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true }))));

describe('BI project fixture', () => {
  it('writes a workspace with one package per integration, like WSO2 Integrator does', async () => {
    const dir = path.join(await mkdtemp(path.join(os.tmpdir(), 'bi-')), 'greeting-project');
    dirs.push(path.dirname(dir));
    await createBIProject(dir, {
      title: 'Greeting Project',
      integrations: [{ name: 'greeting service', title: 'Greeting Service' }],
      distribution: '2201.14.0',
    });
    const root = await readFile(path.join(dir, 'Ballerina.toml'), 'utf8');
    expect(root).toContain('[workspace]');
    expect(root).toContain('packages = ["greeting_service"]');
    expect(JSON.parse(await readFile(path.join(dir, '.vscode', 'settings.json'), 'utf8'))).toEqual({
      'ballerina.isBI': true,
    });

    const pkg = await readFile(path.join(dir, 'greeting_service', 'Ballerina.toml'), 'utf8');
    expect(pkg).toMatch(
      /\[package\][\s\S]*name = "greeting_service"[\s\S]*distribution = "2201.14.0"[\s\S]*title = "Greeting Service"/,
    );
    expect((await readdir(path.join(dir, 'greeting_service'))).sort()).toEqual([
      '.gitignore',
      '.vscode',
      'Ballerina.toml',
      'agents.bal',
      'automation.bal',
      'config.bal',
      'connections.bal',
      'data_mappings.bal',
      'functions.bal',
      'main.bal',
      'types.bal',
    ]);
  });

  it('sanitizes package names', () => {
    expect(sanitizePackageName('My API-v2')).toBe('My_API_v2');
    expect(sanitizePackageName('2fa')).toBe('_2fa');
  });
});
