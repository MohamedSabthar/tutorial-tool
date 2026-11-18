import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ConceptProps } from '../src/concepts';

describe('scene theme', () => {
  it('defaults to the Choreo Labs dark theme', () => {
    expect(ConceptProps.parse({}).theme).toBe('choreo-dark');
  });

  it('still loads scenes saved with the WSO2 theme names', () => {
    expect(ConceptProps.parse({ theme: 'wso2-light' }).theme).toBe('choreo-light');
    expect(ConceptProps.parse({ theme: 'wso2-dark' }).theme).toBe('choreo-dark');
  });

  it('offers only the new names in the props schema (Inspector, agent catalog)', () => {
    const js = z.toJSONSchema(ConceptProps, { io: 'input', unrepresentable: 'any' });
    expect(js.properties?.theme).toMatchObject({ enum: ['choreo-dark', 'choreo-light'] });
  });
});
