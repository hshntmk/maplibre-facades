import { describe, expect, it } from 'vitest';
import { createMaterialTexture } from '../src/material/WallMaterials';

describe('createMaterialTexture (tile)', () => {
  const size = 128;
  const tex = createMaterialTexture('tile', size);
  const at = (level: number, x: number, y: number) => {
    const n = size >> level;
    const i = (((y + n) % n) * n + ((x + n) % n)) * 4;
    return Array.from(tex.levels[level].slice(i, i + 4));
  };

  it('builds a full mip chain down to 1×1', () => {
    expect(tex.levels).toHaveLength(Math.log2(size) + 1);
    tex.levels.forEach((l, i) => expect(l.length).toBe(((size >> i) ** 2) * 4));
    const last = tex.levels.at(-1)!;
    expect(tex.average[0]).toBeCloseTo(last[2] / 255, 2);
    expect(tex.average[1]).toBeCloseTo(last[3] / 255, 2);
  });

  it('stores unit normals that face mostly outwards', () => {
    for (let i = 0; i < size * size; i += 97) {
      const nx = (tex.levels[0][i * 4] / 255) * 2 - 1;
      const ny = (tex.levels[0][i * 4 + 1] / 255) * 2 - 1;
      expect(Math.hypot(nx, ny)).toBeLessThan(1);
    }
  });

  it('has recessed, rough, dark joints and glossy tile faces', () => {
    // 目地（ラフネス大・凹み小）とタイルの面がどちらもある
    const px = Array.from({ length: size * size }, (_, i) => [tex.levels[0][i * 4 + 2], tex.levels[0][i * 4 + 3]]);
    const joints = px.filter(([r]) => r > 0.85 * 255);
    const faces = px.filter(([r]) => r < 0.6 * 255);
    expect(joints.length / px.length).toBeGreaterThan(0.05);
    expect(faces.length / px.length).toBeGreaterThan(0.6);
    const mean = (a: number[][], k: number) => a.reduce((s, p) => s + p[k], 0) / a.length;
    expect(mean(joints, 1)).toBeLessThan(mean(faces, 1));
  });

  it('tiles seamlessly', () => {
    // 端をまたいだ隣り合うテクセルの差が、内側の隣どうしの差と同程度
    const diff = (a: number[], b: number[]) => Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
    let edge = 0, inner = 0;
    for (let y = 0; y < size; y++) {
      edge += diff(at(0, size - 1, y), at(0, 0, y));
      inner += diff(at(0, size / 2 - 1, y), at(0, size / 2, y));
    }
    expect(edge).toBeLessThan(inner * 3 + size * 4);
  });

  it('widens roughness as fine bumps average out in smaller mips', () => {
    const meanRough = (level: number) => {
      const l = tex.levels[level];
      let s = 0;
      for (let i = 0; i < l.length; i += 4) s += l[i + 2];
      return s / (l.length / 4);
    };
    // 細かいレベルの平均より小さくならない（凹凸のばらつきがラフネスに移る）
    expect(meanRough(4)).toBeGreaterThanOrEqual(meanRough(0) * 0.95);
  });

  it('is cached', () => {
    expect(createMaterialTexture('tile', size)).toBe(tex);
  });
});
