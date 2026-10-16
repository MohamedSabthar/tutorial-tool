/** Starter overlay written by "Create sample overlay" (and a template for the agent). */
export const HELLO_OVERLAY = `import { z } from 'zod';
import { DomLayer, theme, useAnchor, useGsap, type OverlayMeta, type OverlayProps } from '@studio/overlay-sdk';

const Props = z.object({
  text: z.string().default('Edit me in HelloOverlay.tsx'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'HelloOverlay',
  description: 'A label that pops in next to the anchored element. Edit this file and watch the preview update.',
  props: Props,
};

export default function HelloOverlay({ props, duration }: OverlayProps<Props>) {
  const anchor = useAnchor();
  const scope = useGsap(
    (tl) => {
      tl.from('.label', { autoAlpha: 0, y: 16, duration: theme.duration.enter, ease: theme.ease.pop }).to(
        '.label',
        { autoAlpha: 0, duration: theme.duration.exit },
        duration - theme.duration.exit,
      );
    },
    [],
  );
  const x = anchor ? anchor.x : 120;
  const y = anchor ? anchor.y - 90 : 120;
  return (
    <DomLayer follow>
      <div ref={scope}>
        <div
          className="label"
          style={{
            position: 'absolute',
            left: x,
            top: y,
            padding: '14px 22px',
            borderRadius: theme.radius,
            background: theme.color.orange,
            color: theme.color.white,
            fontFamily: theme.font.sans,
            fontSize: 34,
            fontWeight: 700,
            boxShadow: theme.shadow,
          }}
        >
          {props.text}
        </div>
      </div>
    </DomLayer>
  );
}
`;
