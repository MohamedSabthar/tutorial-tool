import { execFile, spawn } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * API keys for the engine's own services (ElevenLabs). On macOS they live in the login
 * Keychain; elsewhere in a 0600 file under ~/.config. An environment variable overrides both.
 * Keys never go to the UI, logs, the workspace or the agent.
 */
export type SecretName = 'elevenlabs';

const ENV: Record<SecretName, string> = { elevenlabs: 'ELEVENLABS_API_KEY' };
const SERVICE = 'Tutorial Studio';

export interface SecretStore {
  get(name: SecretName): Promise<{ value: string; source: 'env' | 'keychain' | 'file' } | null>;
  set(name: SecretName, value: string): Promise<void>;
  clear(name: SecretName): Promise<void>;
}

const run = (cmd: string, args: string[]) =>
  new Promise<string>((resolve, reject) =>
    execFile(cmd, args, (err, stdout) => (err ? reject(err) : resolve(stdout.trim()))),
  );

/** Runs `security -i` with a command on stdin, so the key never appears in a process list. */
const securityStdin = (command: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn('security', ['-i'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += String(d)));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 && !err.trim() ? resolve() : reject(new Error(err.trim() || `security exited ${code}`)),
    );
    child.stdin.end(`${command}\n`);
  });

const quote = (s: string) => `"${s.replace(/(["\\])/g, '\\$1')}"`;

export function secretStore(
  opts: { env?: NodeJS.ProcessEnv; file?: string; keychain?: boolean } = {},
): SecretStore {
  const env = opts.env ?? process.env;
  const keychain = opts.keychain ?? process.platform === 'darwin';
  const file = opts.file ?? path.join(os.homedir(), '.config', 'tutorial-studio', 'secrets.json');
  const readFileStore = async (): Promise<Record<string, string>> => {
    try {
      return JSON.parse(await readFile(file, 'utf8')) as Record<string, string>;
    } catch {
      return {};
    }
  };
  return {
    async get(name) {
      const fromEnv = env[ENV[name]];
      if (fromEnv) return { value: fromEnv, source: 'env' };
      if (keychain) {
        const v = await run('security', ['find-generic-password', '-s', SERVICE, '-a', name, '-w']).catch(
          () => '',
        );
        return v ? { value: v, source: 'keychain' } : null;
      }
      const v = (await readFileStore())[name];
      return v ? { value: v, source: 'file' } : null;
    },
    async set(name, value) {
      if (/[\n\r]/.test(value)) throw new Error('the key must be one line');
      if (keychain) {
        await securityStdin(
          `add-generic-password -U -s ${quote(SERVICE)} -a ${quote(name)} -w ${quote(value)}`,
        );
        return;
      }
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ ...(await readFileStore()), [name]: value }, null, 2), {
        mode: 0o600,
      });
      await chmod(file, 0o600);
    },
    async clear(name) {
      if (keychain) {
        await run('security', ['delete-generic-password', '-s', SERVICE, '-a', name]).catch(() => undefined);
        return;
      }
      const all = await readFileStore();
      delete all[name];
      await writeFile(file, JSON.stringify(all, null, 2), { mode: 0o600 });
    },
  };
}
