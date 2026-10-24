import { z } from 'zod';

/** Studio-wide defaults, kept in the workspace (`.studio/settings.json`). */
export const StudioSettings = z.object({
  /** ElevenLabs voice new briefs start with. */
  defaultVoice: z.string().nullable().default(null),
  /** New briefs approve safe tool calls without asking (the brief's Auto mode). */
  autoMode: z.boolean().default(true),
  /** A pipeline run pauses at a help gate once its agent cost passes this (US dollars). */
  maxCostPerRun: z.number().positive().nullable().default(null),
  /**
   * Which Claude models the pipeline's agent uses: `balanced` (Opus for research, planning and
   * repairs; the faster Sonnet for writing the script, narration, alignment, post-production, QA
   * and the retrospective), one model for everything, or `custom` (the two models below).
   */
  agentModel: z.enum(['balanced', 'opus', 'sonnet', 'custom']).default('balanced'),
  /** With `custom`: the model for research, planning and repairs, and the one for everything else. */
  customModels: z
    .object({ deep: z.string().trim().min(1).max(120), writing: z.string().trim().min(1).max(120) })
    .default({ deep: 'claude-opus-5-5', writing: 'claude-sonnet-5-5' }),
  /** Repairs the agent tries on its own when a run fails, before it asks the user for help. */
  maxRepairs: z.number().int().min(0).max(5).default(1),
  /** The Claude Code executable the agent runs; null for the one installed on this Mac. */
  claudeExecutable: z.string().min(1).nullable().default(null),
  /** CLAUDE_CONFIG_DIR for the agent (which Claude login it uses); null for the app's environment. */
  claudeConfigDir: z.string().min(1).nullable().default(null),
});
export type StudioSettings = z.infer<typeof StudioSettings>;

/**
 * A product in the workspace's `products.json`. `app` (an installed VS Code-based app) or
 * `extensions` (marketplace ids for the pinned VS Code) say how it's launched; an entry without
 * either keeps the built-in launch of the product with its id. Other fields are kept as written.
 */
export const ProductConfig = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'ids are lower case letters, digits and dashes'),
    name: z.string().min(1),
    app: z.string().min(1).optional(),
    extensions: z.array(z.string().min(1)).optional(),
    /** The workspace skill with its page objects (defaults to the id). */
    skill: z.string().optional(),
    /** CSS selectors hidden on camera, in the workbench and inside the product's webviews. */
    hide: z
      .object({ workbench: z.array(z.string()).optional(), webview: z.array(z.string()).optional() })
      .optional(),
  })
  .passthrough();
export type ProductConfig = z.infer<typeof ProductConfig>;

export const ProductsFile = z.object({ products: z.array(ProductConfig).default([]) }).passthrough();

/** A product as the recorder will launch it. */
export const ProductInfo = z.object({
  id: z.string(),
  name: z.string(),
  launch: z.enum(['app', 'vscode']),
  /** The .app bundle (launch "app"). */
  app: z.string().nullable(),
  /** Marketplace extensions (launch "vscode"). */
  extensions: z.array(z.string()),
  skill: z.string(),
  /** Shipped with the studio (it can be reconfigured, not removed). */
  builtIn: z.boolean(),
  /** The app is installed (always true for VS Code products: it's downloaded on first use). */
  available: z.boolean(),
});
export type ProductInfo = z.infer<typeof ProductInfo>;

/** One line of the first-run checklist. */
export const SetupItem = z.object({
  id: z.enum([
    'claude-code',
    'claude',
    'elevenlabs',
    'workspace',
    'ffmpeg',
    'product',
    'chromium',
    'firstTake',
  ]),
  label: z.string(),
  ok: z.boolean().nullable(),
  detail: z.string(),
});
export type SetupItem = z.infer<typeof SetupItem>;

/** The agent's Claude sign-in, as `claude auth status` reports it. */
export const ClaudeSignIn = z.object({
  loggedIn: z.boolean(),
  method: z.string().nullable(),
  account: z.string().nullable(),
  configDir: z.string().nullable(),
  error: z.string().nullable(),
});
export type ClaudeSignIn = z.infer<typeof ClaudeSignIn>;
