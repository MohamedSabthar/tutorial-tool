import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/**
 * WSO2 Integrator only recognises a folder as a project when it has a known structure:
 *   BI  a Ballerina workspace: root Ballerina.toml with [workspace] + one package per integration
 *   MI  pom.xml containing <projectType>integration-project</projectType>
 *   SI  *.siddhi files
 * Anything else triggers a blocking "We couldn't detect the project type" modal. This writes
 * a BI project exactly like the product's own "create project" flow (wso2.ballerina 5.x).
 */
export interface BIIntegration {
  /** Package name: letters, digits and "_" (e.g. "greeting_service"). */
  name: string;
  /** Display title shown in WSO2 Integrator. */
  title?: string;
  org?: string;
  version?: string;
  library?: boolean;
}

export interface BIProjectOptions {
  /** Project (workspace) title shown in WSO2 Integrator. */
  title: string;
  integrations?: BIIntegration[];
  /** Ballerina distribution written into each package, e.g. "2201.14.0". Detected when omitted. */
  distribution?: string | null;
}

const EMPTY_BAL = '\n';

const LAUNCH_JSON = `{
    "version": "0.2.0",
    "configurations": [
        {
            "name": "Ballerina Debug",
            "type": "ballerina",
            "request": "launch",
            "programArgs": [],
            "commandOptions": [],
            "env": {}
        },
        {
            "name": "Ballerina Test",
            "type": "ballerina",
            "request": "launch",
            "debugTests": true,
            "programArgs": [],
            "commandOptions": [],
            "env": {}
        }
    ]
}
`;

const GITIGNORE = `target
generated
Config.toml`;

export const sanitizePackageName = (name: string) =>
  name
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/^(\d)/, '_$1') || 'integration';

/** "Swan Lake Update 14" → "2201.14.0", from `bal version`. Null if Ballerina is not installed. */
export async function detectBallerinaDistribution(): Promise<string | null> {
  try {
    const { stdout } = await run('bal', ['version'], { timeout: 15_000 });
    const m = /Ballerina (\d+\.\d+\.\d+)/.exec(stdout);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

async function writeIsBI(dir: string) {
  await mkdir(path.join(dir, '.vscode'), { recursive: true });
  await writeFile(path.join(dir, '.vscode', 'settings.json'), '{\n    "ballerina.isBI": true\n}\n');
}

/** Creates a BI project folder at `dir`. Returns the package folders it created. */
export async function createBIProject(dir: string, opts: BIProjectOptions): Promise<string[]> {
  const integrations = opts.integrations ?? [];
  const distribution =
    opts.distribution === undefined ? await detectBallerinaDistribution() : opts.distribution;
  const names = integrations.map((i) => sanitizePackageName(i.name));

  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'Ballerina.toml'),
    `\n[workspace]\ntitle = "${opts.title}"\npackages = [${names.map((n) => `"${n}"`).join(', ')}]\n\n`,
  );
  await writeIsBI(dir);

  const created: string[] = [];
  for (const [idx, integration] of integrations.entries()) {
    const name = names[idx]!;
    const root = path.join(dir, name);
    await mkdir(root, { recursive: true });
    await writeFile(
      path.join(root, 'Ballerina.toml'),
      `\n[package]\norg = "${integration.org ?? 'studio'}"\nname = "${name}"\nversion = "${integration.version ?? '0.1.0'}"\n` +
        (distribution ? `distribution = "${distribution}"\n` : '') +
        `title = "${integration.title ?? integration.name}"\n\n[build-options]\nsticky = true\n\n`,
    );
    const files = [
      'connections.bal',
      'config.bal',
      'types.bal',
      'agents.bal',
      'functions.bal',
      'data_mappings.bal',
    ];
    if (!integration.library) files.push('main.bal', 'automation.bal');
    for (const f of files) await writeFile(path.join(root, f), EMPTY_BAL);
    if (integration.library) await writeFile(path.join(root, 'lib.bal'), 'import wso2/strict.library as _;');
    await writeIsBI(root);
    await writeFile(path.join(root, '.vscode', 'launch.json'), LAUNCH_JSON);
    await writeFile(path.join(root, '.gitignore'), GITIGNORE);
    created.push(root);
  }
  return created;
}
