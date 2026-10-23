import { z } from 'zod';

/**
 * Props shared by the request-flow looks (BlueprintFlow, LayeredPanels), so a
 * scene can switch look and keep its content. Looks ignore what they don't show.
 */
export const FlowNode = z.object({
  id: z.string(),
  label: z.string(),
  detail: z.string().default(''),
  /** The piece of the request this stop reads (e.g. "/greeting"); it lights up when reached. */
  part: z.string().default(''),
});

export const FlowProps = z.object({
  title: z.string().default('How a request flows'),
  eyebrow: z.string().default(''),
  nodes: z
    .array(FlowNode)
    .min(2)
    .max(6)
    .default([
      { id: 'client', label: 'Client', detail: 'A client sends GET /greeting/hello', part: 'localhost' },
      {
        id: 'listener',
        label: 'Listener :9090',
        detail: 'The listener receives it on port 9090',
        part: ':9090',
      },
      {
        id: 'service',
        label: 'Service /greeting',
        detail: 'The base path picks the service',
        part: '/greeting',
      },
      { id: 'resource', label: 'Resource hello', detail: 'The resource runs and replies', part: '/hello' },
    ]),
  /** Node ids in the order the request visits them (defaults to the node order). */
  flow: z.array(z.string()).default([]),
  /** The request, shown as it travels (e.g. "GET /greeting/hello"). */
  request: z.string().default('GET /greeting/hello'),
  /** Shown once the request has been handled; empty for none. */
  reply: z.string().default('200 OK · Hello, World!'),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
export type FlowProps = z.infer<typeof FlowProps>;

/** The nodes in visiting order. */
export function flowOrder(props: FlowProps): FlowProps['nodes'] {
  const ids = props.flow.length ? props.flow : props.nodes.map((n) => n.id);
  return ids.map((id) => props.nodes.find((n) => n.id === id)).filter((n) => n !== undefined);
}
