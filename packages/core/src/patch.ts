import { z } from 'zod';
import { parseTimeline, type Timeline, TimelineError } from './schemas';

/**
 * Timeline patches: a subset of RFC 6902 JSON Patch (add, remove, replace, move, test).
 * Every change to tutorial.json goes through `applyPatch`, so undo (`invertPatch`) and
 * window sync work for user, agent and automatic edits alike.
 */
const Pointer = z.string().regex(/^(\/([^/~]|~[01])*)+$/, 'paths are JSON pointers like "/overlays/0/start"');

export const PatchOp = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), path: Pointer, value: z.unknown() }),
  z.object({ op: z.literal('remove'), path: Pointer }),
  z.object({ op: z.literal('replace'), path: Pointer, value: z.unknown() }),
  z.object({ op: z.literal('move'), from: Pointer, path: Pointer }),
  z.object({ op: z.literal('test'), path: Pointer, value: z.unknown() }),
]);
export type PatchOp = z.infer<typeof PatchOp>;

export const TimelinePatch = z.array(PatchOp).min(1);
export type TimelinePatch = z.infer<typeof TimelinePatch>;

export class PatchError extends Error {
  override name = 'PatchError';
  constructor(
    message: string,
    readonly opIndex?: number,
  ) {
    super(opIndex === undefined ? message : `op ${opIndex}: ${message}`);
  }
}

type Json = unknown;
type Container = Record<string, Json> | Json[];

function parsePointer(path: string): string[] {
  return path
    .split('/')
    .slice(1)
    .map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~'));
}

function resolveParent(doc: Json, path: string): { parent: Container; key: string } {
  const parts = parsePointer(path);
  const key = parts.pop()!;
  let cur: Json = doc;
  for (const p of parts) {
    if (Array.isArray(cur)) cur = cur[arrayIndex(cur, p, false)];
    else if (cur && typeof cur === 'object') cur = (cur as Record<string, Json>)[p];
    else cur = undefined;
    if (cur === undefined) throw new PatchError(`path "${path}" does not exist`);
  }
  if (!cur || typeof cur !== 'object') throw new PatchError(`path "${path}" does not exist`);
  return { parent: cur as Container, key };
}

function arrayIndex(arr: Json[], key: string, forInsert: boolean): number {
  if (forInsert && key === '-') return arr.length;
  if (!/^(0|[1-9]\d*)$/.test(key)) throw new PatchError(`"${key}" is not an array index`);
  const i = Number(key);
  const max = forInsert ? arr.length : arr.length - 1;
  if (i > max) throw new PatchError(`index ${i} is out of range (length ${arr.length})`);
  return i;
}

function get(doc: Json, path: string): Json {
  const { parent, key } = resolveParent(doc, path);
  if (Array.isArray(parent)) return parent[arrayIndex(parent, key, false)];
  if (!(key in parent)) throw new PatchError(`path "${path}" does not exist`);
  return parent[key];
}

function has(doc: Json, path: string): boolean {
  try {
    get(doc, path);
    return true;
  } catch {
    return false;
  }
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function applyOp(doc: Json, op: PatchOp): void {
  switch (op.op) {
    case 'add': {
      const { parent, key } = resolveParent(doc, op.path);
      if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, true), 0, clone(op.value));
      else parent[key] = clone(op.value);
      return;
    }
    case 'remove': {
      const { parent, key } = resolveParent(doc, op.path);
      if (Array.isArray(parent)) parent.splice(arrayIndex(parent, key, false), 1);
      else {
        if (!(key in parent)) throw new PatchError(`path "${op.path}" does not exist`);
        delete parent[key];
      }
      return;
    }
    case 'replace': {
      const { parent, key } = resolveParent(doc, op.path);
      if (Array.isArray(parent)) parent[arrayIndex(parent, key, false)] = clone(op.value);
      else {
        if (!(key in parent)) throw new PatchError(`path "${op.path}" does not exist`);
        parent[key] = clone(op.value);
      }
      return;
    }
    case 'move': {
      if (op.path.startsWith(op.from + '/')) throw new PatchError('cannot move a value into itself');
      const value = get(doc, op.from);
      applyOp(doc, { op: 'remove', path: op.from });
      applyOp(doc, { op: 'add', path: op.path, value });
      return;
    }
    case 'test': {
      if (JSON.stringify(get(doc, op.path)) !== JSON.stringify(op.value))
        throw new PatchError(`test failed at "${op.path}"`);
      return;
    }
  }
}

/**
 * Applies a patch to a copy of `timeline` and validates the result.
 * Throws PatchError (bad op) or TimelineError (result is not a valid timeline);
 * the input is never modified.
 */
export function applyPatch(timeline: Timeline, patch: TimelinePatch): Timeline {
  const parsed = TimelinePatch.safeParse(patch);
  if (!parsed.success) throw new PatchError(parsed.error.issues.map((i) => i.message).join('; '));
  const doc = structuredClone(timeline) as Json;
  parsed.data.forEach((op, i) => {
    try {
      applyOp(doc, op);
    } catch (e) {
      throw e instanceof PatchError && e.opIndex === undefined ? new PatchError(e.message, i) : e;
    }
  });
  try {
    return parseTimeline(doc);
  } catch (e) {
    if (e instanceof TimelineError)
      throw new TimelineError(`patch makes the timeline invalid:\n${e.message}`);
    throw e;
  }
}

/**
 * Returns the patch that undoes `patch` when applied to the result of `applyPatch(before, patch)`.
 */
export function invertPatch(before: Timeline, patch: TimelinePatch): TimelinePatch {
  const doc = structuredClone(before) as Json;
  const inverse: PatchOp[] = [];
  for (const op of patch) {
    switch (op.op) {
      case 'add': {
        const { parent, key } = resolveParent(doc, op.path);
        if (!Array.isArray(parent) && key in parent)
          inverse.push({ op: 'replace', path: op.path, value: clone(parent[key]) });
        else if (Array.isArray(parent)) {
          const i = arrayIndex(parent, key, true);
          inverse.push({ op: 'remove', path: replaceLast(op.path, String(i)) });
        } else inverse.push({ op: 'remove', path: op.path });
        break;
      }
      case 'remove':
        inverse.push({ op: 'add', path: op.path, value: clone(get(doc, op.path)) });
        break;
      case 'replace':
        inverse.push({ op: 'replace', path: op.path, value: clone(get(doc, op.path)) });
        break;
      case 'move': {
        // Moving back restores an overwritten object key too, if there was one.
        const overwritten =
          has(doc, op.path) && !isArrayPath(doc, op.path) ? clone(get(doc, op.path)) : undefined;
        // Pushed in reverse order because the whole inverse is reversed at the end.
        if (overwritten !== undefined) inverse.push({ op: 'add', path: op.path, value: overwritten });
        inverse.push({ op: 'move', from: op.path, path: op.from });
        break;
      }
      case 'test':
        break;
    }
    applyOp(doc, op);
  }
  return inverse.reverse();
}

function replaceLast(path: string, key: string): string {
  return path.slice(0, path.lastIndexOf('/') + 1) + key;
}

function isArrayPath(doc: Json, path: string): boolean {
  return Array.isArray(resolveParent(doc, path).parent);
}
