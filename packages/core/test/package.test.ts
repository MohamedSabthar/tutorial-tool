import { describe, expect, it } from 'vitest';
import { PACKAGE } from '../src/index';

describe('@studio/core', () => {
  it('exposes its package descriptor', () => {
    expect(PACKAGE.name).toBe('@studio/core');
  });
});
