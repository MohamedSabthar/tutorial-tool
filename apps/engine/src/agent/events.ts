import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { AgentEventInput } from '@studio/core';

const MAX_TEXT = 4000;

export const clip = (s: string, n = MAX_TEXT) =>
  s.length > n ? `${s.slice(0, n)}… (${s.length - n} more)` : s;

/** One line describing a tool call: the path, command or pattern it works on. */
export function summarizeInput(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]) => {
    for (const k of keys) if (typeof i[k] === 'string' && i[k]) return i[k];
    return '';
  };
  const s =
    pick('command', 'file_path', 'path', 'pattern', 'url', 'query', 'skill', 'description', 'prompt') ||
    JSON.stringify(input ?? {});
  return clip(s.replace(/\s+/g, ' ').trim(), 160) || name;
}

type Block = { type: string; [k: string]: unknown };

function toolResultText(content: unknown): { text: string; images: number } {
  if (typeof content === 'string') return { text: clip(content), images: 0 };
  if (!Array.isArray(content)) return { text: '', images: 0 };
  let images = 0;
  const parts: string[] = [];
  for (const b of content as Block[]) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image') images++;
  }
  return { text: clip(parts.join('\n')), images };
}

/**
 * Turns one Agent SDK message into the events the UI shows. Streaming partials, hook
 * chatter and bookkeeping messages are dropped; anything unexpected is ignored rather than
 * thrown, so a new SDK message type can never break the session loop.
 */
export function normalize(m: SDKMessage, resumed: boolean): AgentEventInput[] {
  switch (m.type) {
    case 'system':
      if (m.subtype === 'init')
        return [
          {
            kind: 'init',
            sessionId: m.session_id,
            model: m.model,
            cwd: m.cwd,
            tools: m.tools,
            skills: m.skills ?? [],
            mcpServers: m.mcp_servers.map((s) => ({ name: s.name, status: s.status })),
            permissionMode: m.permissionMode,
            resumed,
          },
        ];
      if (m.subtype === 'api_retry')
        return [
          {
            kind: 'status',
            text: `API error${m.error_status ? ` ${m.error_status}` : ''}; retry ${m.attempt}/${m.max_retries} in ${Math.round(m.retry_delay_ms / 1000)} s`,
          },
        ];
      if (m.subtype === 'compact_boundary') return [{ kind: 'status', text: 'Conversation compacted' }];
      return [];
    case 'assistant': {
      // Subagent frames carry parent_tool_use_id; the console shows the main thread only.
      if (m.parent_tool_use_id) return [];
      const out: AgentEventInput[] = [];
      for (const b of m.message.content as unknown as Block[]) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim())
          out.push({ kind: 'text', text: b.text });
        else if (b.type === 'thinking' && typeof b.thinking === 'string' && b.thinking.trim())
          out.push({ kind: 'thinking', text: clip(b.thinking) });
        else if (b.type === 'tool_use' || b.type === 'server_tool_use' || b.type === 'mcp_tool_use')
          out.push({
            kind: 'tool_use',
            id: String(b.id),
            name: String(b.name),
            summary: summarizeInput(String(b.name), b.input),
            input: b.input,
          });
      }
      if (m.error) out.push({ kind: 'error', text: `Assistant error: ${m.error}` });
      return out;
    }
    case 'user': {
      if (m.parent_tool_use_id) return [];
      const content = m.message.content;
      if (!Array.isArray(content)) return [];
      const out: AgentEventInput[] = [];
      for (const b of content as unknown as Block[]) {
        if (b.type !== 'tool_result') continue;
        const { text, images } = toolResultText(b.content);
        out.push({
          kind: 'tool_result',
          id: String(b.tool_use_id),
          isError: b.is_error === true,
          text,
          images,
        });
      }
      return out;
    }
    case 'result':
      return [
        {
          kind: 'result',
          ok: m.subtype === 'success' && !m.is_error,
          subtype: m.subtype,
          turns: m.num_turns,
          durationMs: m.duration_ms,
          costUsd: m.total_cost_usd,
          text: m.subtype === 'success' ? clip(m.result) : clip(m.errors.join('\n')),
        },
      ];
    default:
      return [];
  }
}
