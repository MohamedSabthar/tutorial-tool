import { z } from 'zod';
import {
  DomLayer,
  theme,
  ThreeLayer,
  useAnchor,
  useGsap,
  useOverlayTime,
  useStageToScene,
  type OverlayMeta,
  type OverlayProps,
} from '@studio/overlay-sdk';

/**
 * A sample overlay written only against the overlay SDK, the way the agent writes them:
 * a callout card that pops in next to the anchored element and types out code (GSAP, DOM),
 * plus a pulsing ring around the element (three.js through ThreeLayer).
 */
const Props = z.object({
  title: z.string().default('Service path'),
  code: z.string().default('GET :9090/greeting/hello'),
});
type Props = z.infer<typeof Props>;

export const meta: OverlayMeta = {
  name: 'SampleCallout',
  description: 'Callout that types out a code snippet next to an element, with a 3D ring around it',
  props: Props,
  defaultDuration: 4,
};

function Ring({ x, y, w, h }: { x: number; y: number; w: number; h: number }) {
  const { t } = useOverlayTime();
  const toScene = useStageToScene();
  const [cx, cy] = toScene(x + w / 2, y + h / 2);
  const pulse = (t * 1.4) % 1;
  const radius = Math.max(w, h) / 2 + 18;
  return (
    <mesh
      position={[cx, cy, 1]}
      scale={[1 + pulse * 0.25, (1 + pulse * 0.25) * Math.min(1, (h + 36) / (w + 36)) * 1, 1]}
    >
      <ringGeometry args={[radius - 4, radius, 96]} />
      <meshBasicMaterial
        color={theme.color.orange}
        transparent
        opacity={0.9 * (1 - pulse)}
        toneMapped={false}
      />
    </mesh>
  );
}

export default function SampleCallout({ props, duration }: OverlayProps<Props>) {
  const anchor = useAnchor();
  const scope = useGsap(
    (tl) => {
      tl.from('.card', {
        autoAlpha: 0,
        scale: 0.85,
        y: 12,
        transformOrigin: '0% 50%',
        duration: theme.duration.enter,
        ease: theme.ease.pop,
      })
        .from('.rule', { width: 0, duration: 0.3, ease: theme.ease.out }, 0.15)
        .to('.code', { text: props.code, duration: 1.2, ease: 'none' }, 0.4)
        .to(
          '.card',
          { autoAlpha: 0, y: -8, duration: theme.duration.exit, ease: theme.ease.in },
          duration - theme.duration.exit,
        );
    },
    [props.code],
  );
  if (!anchor) return null;
  const left = anchor.x + anchor.w + 28;
  const top = anchor.y + anchor.h / 2 - 70;
  return (
    <>
      <ThreeLayer>
        <Ring x={anchor.x} y={anchor.y} w={anchor.w} h={anchor.h} />
      </ThreeLayer>
      <DomLayer follow>
        <div ref={scope}>
          <div
            className="card"
            style={{
              position: 'absolute',
              left,
              top,
              width: 420,
              background: theme.color.white,
              borderRadius: theme.radius,
              boxShadow: theme.shadow,
              padding: '18px 22px',
              fontFamily: theme.font.sans,
              color: theme.color.navy,
            }}
          >
            <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>{props.title}</div>
            <div
              className="rule"
              style={{ width: 48, height: 3, background: theme.color.orange, margin: '8px 0 12px' }}
            />
            <div
              className="code"
              style={{
                fontFamily: theme.font.mono,
                fontSize: 20,
                background: theme.color.gray50,
                borderRadius: 8,
                padding: '10px 12px',
                minHeight: 26,
              }}
            />
          </div>
        </div>
      </DomLayer>
    </>
  );
}

/** Throws on render, to show that one broken overlay doesn't take down the stage. */
export function BrokenOverlay(): never {
  throw new Error('BrokenOverlay: this overlay fails on purpose');
}
