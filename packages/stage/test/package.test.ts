import { describe, expect, it } from 'vitest';
import { PACKAGE } from '../src/index';

describe('@studio/stage', () => {
  it('exposes its package descriptor', () => {
    expect(PACKAGE.name).toBe('@studio/stage');
  });
});
