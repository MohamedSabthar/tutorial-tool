import { useState } from 'react';
import { Button, Chip } from '@studio/ui';
import { useEngine } from '../engine';
import { useAgent } from './useAgent';

/** Tool calls of a project's agent that wait for Allow or Deny, for screens without the agent panel. */
export function PermissionRequests({ slug }: { slug: string }) {
  const agent = useAgent(slug);
  const { client } = useEngine();
  const [auto, setAuto] = useState<'idle' | 'busy' | 'on'>('idle');
  const pending = new Set(agent.status?.pending ?? []);
  const waiting = agent.events.filter((e) => e.kind === 'permission' && pending.has(e.requestId));
  if (!waiting.length) return null;
  const autoMode = async () => {
    if (!client) return;
    setAuto('busy');
    try {
      const brief = await client.call('brief.get', { slug });
      await client.call('brief.save', { slug, brief: { ...brief, autoMode: true } });
      setAuto('on');
    } catch {
      setAuto('idle');
    }
  };
  return (
    <div role="alert" className="permission-requests">
      <div className="permission-request">
        <span className="permission-request-text">
          The agent is waiting for you. Answer below, or let auto mode approve safe calls from now on.
        </span>
        <Button size="sm" variant="steel" disabled={auto !== 'idle'} onClick={() => void autoMode()}>
          {auto === 'on' ? 'Auto mode on' : 'Turn on auto mode'}
        </Button>
      </div>
      {waiting.map(
        (e) =>
          e.kind === 'permission' && (
            <div key={e.requestId} className="permission-request">
              <Chip tone="active" mono>
                Needs approval
              </Chip>
              <span className="permission-request-text">
                <strong>{e.tool}</strong> <code>{e.summary}</code>
                {e.reason && <span className="permission-request-reason">{e.reason}</span>}
              </span>
              <Button size="sm" variant="primary" onClick={() => void agent.answer(e.requestId, true)}>
                Allow
              </Button>
              <Button size="sm" onClick={() => void agent.answer(e.requestId, false)}>
                Deny
              </Button>
            </div>
          ),
      )}
    </div>
  );
}
