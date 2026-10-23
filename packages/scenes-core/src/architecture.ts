import { z } from 'zod';

const Box = z.object({
  id: z.string(),
  label: z.string(),
  /** Said about the box while it is in focus. */
  detail: z.string().default(''),
  /** What is inside, shown when the view is on the box. */
  inner: z.array(z.string()).max(4).default([]),
  /** Position and size on a 12×6 grid (the Blueprint look's map). */
  x: z.number().min(0).max(12),
  y: z.number().min(0).max(6),
  w: z.number().min(1).max(12),
  h: z.number().min(1).max(6),
});

/** Props shared by the architecture looks (BlueprintDive, DepthLayers), so a scene can switch look. */
export const ArchitectureProps = z.object({
  title: z.string().default('Where it fits'),
  eyebrow: z.string().default(''),
  boxes: z
    .array(Box)
    .min(1)
    .max(10)
    .default([
      {
        id: 'clients',
        label: 'Clients',
        detail: 'Apps that call your API',
        inner: ['Web app', 'Mobile app'],
        x: 0,
        y: 1.5,
        w: 2.4,
        h: 3,
      },
      {
        id: 'integrator',
        label: 'WSO2 Integrator',
        detail: 'Your HTTP service runs here',
        inner: ['Listener :9090', 'Service /greeting', 'Resource GET hello'],
        x: 4,
        y: 0.5,
        w: 4,
        h: 5,
      },
      {
        id: 'backends',
        label: 'Back ends',
        detail: 'What your service calls in turn',
        inner: ['Database', 'Payments API'],
        x: 9.6,
        y: 1.5,
        w: 2.4,
        h: 3,
      },
    ]),
  /** Connections drawn between boxes, with requests flowing along them. */
  links: z.array(z.tuple([z.string(), z.string()])).default([
    ['clients', 'integrator'],
    ['integrator', 'backends'],
  ]),
  /** Box ids to bring into view, one per beat (or narration line); defaults to every box in order. */
  focus: z.array(z.string()).default(['clients', 'integrator', 'backends']),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
export type ArchitectureProps = z.infer<typeof ArchitectureProps>;

/** The boxes in focus order. */
export function focusOrder(props: ArchitectureProps): ArchitectureProps['boxes'] {
  const ids = props.focus.length ? props.focus : props.boxes.map((b) => b.id);
  return ids.map((id) => props.boxes.find((b) => b.id === id)).filter((b) => b !== undefined);
}
