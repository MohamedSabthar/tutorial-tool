import { Button, Chip } from '@studio/ui';
import { useAgent } from './useAgent';

/** Tool calls of a project's agent that wait for Allow or Deny, for screens without the agent panel. */
export function PermissionRequests({ slug }: { slug: string }) {
  const agent = useAgent(slug);
  const pending = new Set(agent.status?.pending ?? []);
  const waiting = agent.events.filter((e) => e.kind === 'permission' && pending.has(e.requestId));
  if (!waiting.length) return null;
  return (
    <div role="alert" className="permission-requests">
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
