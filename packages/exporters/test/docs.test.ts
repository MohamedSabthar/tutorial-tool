import { describe, expect, it } from 'vitest';
import { renderMarkdown, toSrt, toVtt, validateVtt } from '../src/index';

const cues = [
  { id: 'c2', start: 3, end: 6.5, text: 'Then add a resource.' },
  { id: 'c1', start: 0.251, end: 3.5, text: 'Open the catalogue\nand pick HTTP.' },
  { id: 'c3', start: 7, end: 7, text: 'empty span' },
  { id: 'c4', start: 3661.5, end: 3663, text: 'a --> b' },
];

describe('captions', () => {
  it('writes SRT with numbered cues in order, overlaps trimmed', () => {
    expect(toSrt(cues)).toBe(
      [
        '1\n00:00:00,251 --> 00:00:03,000\nOpen the catalogue\nand pick HTTP.\n',
        '2\n00:00:03,000 --> 00:00:06,500\nThen add a resource.\n',
        '3\n01:01:01,500 --> 01:01:03,000\na --> b\n',
      ].join('\n'),
    );
  });

  it('writes valid WebVTT', () => {
    const vtt = toVtt(cues);
    expect(vtt.startsWith('WEBVTT\n\n00:00:00.251 --> 00:00:03.000\n')).toBe(true);
    expect(vtt).toContain('a → b');
    expect(validateVtt(vtt)).toEqual([]);
    expect(validateVtt(toVtt([]))).toEqual([]);
  });

  it('finds problems in broken WebVTT', () => {
    expect(validateVtt('00:00:01.000 --> 00:00:02.000\nhi')).toContain('missing the WEBVTT header');
    expect(validateVtt('WEBVTT\n\n00:00:02.000 --> 00:00:01.000\nhi')).toEqual([
      'cue 1: ends before it starts',
    ]);
    expect(validateVtt('WEBVTT\n\n0:1 --> 0:2\nhi')[0]).toMatch(/bad timestamp/);
  });
});

describe('markdown', () => {
  it('renders the title, links and numbered steps with stills', () => {
    const md = renderMarkdown({
      title: 'Create an HTTP service',
      intro: 'Build a greeting API.',
      video: 'my demo.mp4',
      captions: 'captions.vtt',
      steps: [
        {
          title: 'Open [the] catalogue',
          instruction: 'Click **Add Artifact**.',
          image: 'images/step-01.jpg',
        },
        { title: 'Save', instruction: '' },
      ],
    });
    expect(md).toBe(
      [
        '# Create an HTTP service',
        '',
        'Build a greeting API.',
        '',
        '[Watch the video](my%20demo.mp4) · [captions](captions.vtt)',
        '',
        '## 1. Open [the] catalogue',
        '',
        'Click **Add Artifact**.',
        '',
        '![Open \\[the\\] catalogue](images/step-01.jpg)',
        '',
        '## 2. Save',
        '',
      ].join('\n'),
    );
  });
});
