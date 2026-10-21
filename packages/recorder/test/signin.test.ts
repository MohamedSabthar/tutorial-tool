import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { signedInProfile, signInDir, signInStatus, signOut } from '../src/launch/signin';
import { copyProfile } from '../src/launch/vscode';

describe('signed-in profiles', () => {
  let cache: string;
  beforeEach(async () => void (cache = await mkdtemp(path.join(os.tmpdir(), 'signin-'))));
  afterEach(() => rm(cache, { recursive: true, force: true }));

  const put = async (rel: string) => {
    const file = path.join(signInDir('wso2-integrator', cache), rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, 'x');
  };

  it('is used once saved, and forgotten on sign-out', async () => {
    expect(signedInProfile('wso2-integrator', cache)).toBeUndefined();
    expect(await signInStatus('wso2-integrator', cache)).toMatchObject({ saved: false, open: false });
    await put('User/globalStorage/state.vscdb');
    expect(signedInProfile('wso2-integrator', cache)).toBe(signInDir('wso2-integrator', cache));
    expect((await signInStatus('wso2-integrator', cache)).saved).toBe(true);
    await signOut('wso2-integrator', cache);
    expect(signedInProfile('wso2-integrator', cache)).toBeUndefined();
  });

  it('copies the login state but not caches, logs, folder state or locks', async () => {
    for (const rel of [
      'User/globalStorage/state.vscdb',
      'Local Storage/leveldb/000003.log',
      'Cookies',
      'Cache/data_0',
      'Code Cache/js/index',
      'logs/main.log',
      'User/workspaceStorage/abc/state.vscdb',
      'SingletonLock',
      'Local Storage/leveldb/LOCK',
    ])
      await put(rel);
    const to = path.join(cache, 'copy');
    await copyProfile(signInDir('wso2-integrator', cache), to);
    const has = (rel: string) => existsSync(path.join(to, rel));
    expect(has('User/globalStorage/state.vscdb')).toBe(true);
    expect(has('Local Storage/leveldb/000003.log')).toBe(true);
    expect(has('Cookies')).toBe(true);
    for (const rel of [
      'Cache',
      'Code Cache',
      'logs',
      'User/workspaceStorage',
      'SingletonLock',
      'Local Storage/leveldb/LOCK',
    ])
      expect(has(rel), rel).toBe(false);
  });
});
