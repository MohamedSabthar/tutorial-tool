import { useState } from 'react';
import {
  AppHeader,
  Button,
  Chip,
  EdgeAccent,
  Eyebrow,
  Field,
  GateBanner,
  IconButton,
  IconNext,
  IconPlay,
  IconPrev,
  Input,
  LinkButton,
  MonoBox,
  Panel,
  Pill,
  Pin,
  Progress,
  Segmented,
  Select,
  Stepper,
  Switch,
  TextArea,
  Title,
  tokens,
  type NavKey,
} from '@studio/ui';
import { Page } from '../shell';

const swatches: [string, string][] = [
  ['orange', tokens.color.orange],
  ['orange-100', tokens.color.orange100],
  ['navy', tokens.color.navy],
  ['white', tokens.color.white],
  ['gray-50', tokens.color.gray50],
  ['gray-300', tokens.color.gray300],
  ['gray-600', tokens.color.gray600],
  ['ink', tokens.color.ink],
  ['steel', tokens.color.steel],
  ['steel-100', tokens.color.steel100],
  ['green-100', tokens.color.green100],
  ['red-100', tokens.color.red100],
];

export function KitPage() {
  const [nav, setNav] = useState<NavKey>('studio');
  const [audience, setAudience] = useState('Developer');
  const [view, setView] = useState('Final');
  const [explainers, setExplainers] = useState(true);
  const [progress, setProgress] = useState(0.36);

  return (
    <Page
      title="Step 0.5 · Design kit"
      intro="Every shared component from @studio/ui in its states, matching the canvas mockups (WSO2 light theme). Tab through the page to check focus rings and labels."
    >
      <Panel title="Colours">
        <div
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 10 }}
        >
          {swatches.map(([name, hex]) => (
            <div key={name} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span
                style={{
                  height: 44,
                  borderRadius: 10,
                  background: hex,
                  border: '1px solid var(--ui-gray-300)',
                }}
              />
              <span className="ui-mono" style={{ fontSize: 11 }}>
                {name} · {hex}
              </span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel title="Type and brand marks">
        <Title>What should we teach today</Title>
        <Title level={2} size={22}>
          Recent tutorials
        </Title>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <Eyebrow>Eyebrow label</Eyebrow>
          <span>Body text in Inter, 13px.</span>
          <span className="ui-mono">0:52.40 · mono data</span>
        </div>
        <div
          style={{
            position: 'relative',
            height: 60,
            background: 'var(--ui-gray-50)',
            borderRadius: 10,
            paddingLeft: 20,
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <EdgeAccent />
          Left-edge accent strip
        </div>
      </Panel>

      <Panel title="Header" flush style={{ overflow: 'hidden' }}>
        <AppHeader
          current={nav}
          onNavigate={setNav}
          center={
            <Pill
              items={[
                <strong key="t">Create an HTTP service</strong>,
                'WSO2 Integrator v1.4.2',
                'run #8',
                'Saved',
              ]}
            />
          }
          actions={
            <>
              <Button>Re-record</Button>
              <Button variant="primary">Export</Button>
            </>
          }
        />
      </Panel>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <Panel title="Buttons" style={{ flex: '1 1 420px' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button variant="primary">Primary</Button>
            <Button>Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="danger">Revert run</Button>
            <Button variant="accent">+ Insert explainer here</Button>
            <Button variant="steel">Send open annotations (2)</Button>
            <Button variant="primary" disabled>
              Disabled
            </Button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <Button size="sm">Small</Button>
            <Button size="lg" variant="primary">
              Plan and record
            </Button>
            <LinkButton href="#/kit">Link button</LinkButton>
            <IconButton label="Previous step">
              <IconPrev size={14} />
            </IconButton>
            <IconButton label="Play" variant="primary">
              <IconPlay size={14} />
            </IconButton>
            <IconButton label="Next step">
              <IconNext size={14} />
            </IconButton>
          </div>
        </Panel>

        <Panel title="Segmented and chips" style={{ flex: '1 1 420px' }}>
          <Segmented
            label="Audience"
            options={['New to WSO2', 'Developer', 'Architect']}
            value={audience}
            onChange={setAudience}
          />
          <Segmented
            label="View"
            options={['Final', 'With annotations', 'Raw take']}
            value={view}
            onChange={setView}
            block
          />
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Chip>Draft</Chip>
            <Chip tone="ok">Exported</Chip>
            <Chip tone="active">In edit</Chip>
            <Chip tone="info">Storyboard review</Chip>
            <Chip tone="error">Dry run failed</Chip>
            <Chip tone="ok" dot>
              Idle
            </Chip>
            <Chip mono>$1.84 · 41 min</Chip>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Pin n={1} resolved />
            <Pin n={2} />
            <Pin n={3} />
            <span style={{ color: 'var(--ui-gray-600)' }}>Annotation pins (resolved, open)</span>
          </div>
        </Panel>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 20 }}>
        <Panel title="Pipeline" style={{ flex: '1 1 300px' }}>
          <Stepper
            steps={[
              { label: 'Plan steps', sub: '6 steps · 1 explainer', state: 'done' },
              { label: 'Storyboard review', sub: 'approved by you', state: 'gate' },
              { label: 'Dry run', sub: 'failed at step 5', state: 'failed' },
              { label: 'Record', sub: 'take 2 · step 3 of 6', state: 'active' },
              { label: 'Voice-over & overlays', state: 'todo' },
            ]}
          />
        </Panel>

        <Panel title="Form fields" style={{ flex: '1 1 420px' }}>
          <Field label="What should the viewer learn?" hint="The agent plans from this.">
            {(id) => (
              <TextArea
                id={id}
                rows={2}
                defaultValue="Create an HTTP service with a GET /greeting resource."
              />
            )}
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Product">
              {(id) => (
                <Select id={id}>
                  <option>WSO2 Integrator</option>
                  <option>Micro Integrator</option>
                </Select>
              )}
            </Field>
            <Field label="Port">{(id) => <Input id={id} defaultValue="9090" className="ui-mono" />}</Field>
          </div>
          <Field label="Invalid input">
            {(id) => <Input id={id} aria-invalid="true" defaultValue="-1" />}
          </Field>
          <Switch label="Let the agent propose explainers" checked={explainers} onChange={setExplainers} />
        </Panel>
      </div>

      <Panel title="Gate banner, progress and mono box" flush style={{ overflow: 'hidden' }}>
        <GateBanner
          title="Storyboard gate: the agent is paused for your review"
          text="6 recorded steps and 1 explainer. Recording starts after you approve."
          actions={
            <>
              <Button>Re-plan</Button>
              <Button variant="primary">Approve and record →</Button>
            </>
          }
        />
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span
              style={{
                fontSize: 40,
                fontWeight: 700,
                letterSpacing: '-0.02em',
                color: 'var(--ui-orange-bright)',
              }}
            >
              {Math.round(progress * 100)}%
            </span>
            <Button size="sm" onClick={() => setProgress((p) => (p >= 1 ? 0 : Math.min(1, p + 0.16)))}>
              Advance
            </Button>
          </div>
          <Progress value={progress} label="Export progress" />
          <MonoBox>
            {'✓ check_overlay: types, lint\n✓ determinism: 6 frames identical\n· $0.21 · 48 s'}
          </MonoBox>
        </div>
      </Panel>

      <Panel title="Dark panel" tone="dark">
        <span>For &quot;What happens next&quot; style callouts on light pages.</span>
      </Panel>
    </Page>
  );
}
