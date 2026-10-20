import { describe, expect, it } from 'vitest';
import { fogBlendOpacity } from '../src/terrain/Fog';

describe('fogBlendOpacity', () => {
  it('matches MapLibre: off below 60°, fades in to 70°', () => {
    expect(fogBlendOpacity(45)).toBe(0);
    expect(fogBlendOpacity(60)).toBe(0);
    expect(fogBlendOpacity(65)).toBeCloseTo(0.5);
    expect(fogBlendOpacity(70)).toBe(1);
    expect(fogBlendOpacity(85)).toBe(1);
  });
});
