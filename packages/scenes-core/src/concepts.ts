import { z } from 'zod';

/** Props shared by the concept looks (CardDeck, TermSpotlight), so a scene can switch look. */
export const ConceptProps = z.object({
  title: z.string().default('Three ideas to know'),
  eyebrow: z.string().default(''),
  /** One per beat (or narration line): a term and what it means. */
  cards: z
    .array(z.object({ title: z.string(), text: z.string().default('') }))
    .min(1)
    .max(4)
    .default([
      { title: 'Listener', text: 'Accepts requests on a port, like 9090.' },
      { title: 'Service', text: 'Groups resources under one base path, like /greeting.' },
      { title: 'Resource', text: 'One method and path that runs your code, like GET hello.' },
    ]),
  theme: z.enum(['wso2-dark', 'wso2-light']).default('wso2-dark'),
});
export type ConceptProps = z.infer<typeof ConceptProps>;
