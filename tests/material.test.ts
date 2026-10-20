import { describe, expect, it } from 'vitest';
import { MATERIAL_PROPS, MAX_WALL_MATERIALS, WALL_MATERIALS, createMaterialTexture, type WallMaterialName } from '../src/material/WallMaterials';

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

describe('wall materials (concrete, stone, metal)', () => {
  const size = 128;
  const stats = (name: WallMaterialName) => {
    const tex = createMaterialTexture(name, size);
    const l = tex.levels[0];
    const px = Array.from({ length: size * size }, (_, i) => ({ rough: l[i * 4 + 2] / 255, cavity: l[i * 4 + 3] / 255 }));
    return { tex, px, share: (f: (p: { rough: number; cavity: number }) => boolean) => px.filter(f).length / px.length };
  };

  it('defines properties and a full mip chain for every material', () => {
    expect(WALL_MATERIALS.length).toBeLessThanOrEqual(MAX_WALL_MATERIALS);
    for (const name of WALL_MATERIALS) {
      const tex = createMaterialTexture(name, size);
      expect(tex.levels, name).toHaveLength(Math.log2(size) + 1);
      expect(tex.period[0], name).toBe(MATERIAL_PROPS[name].period);
      expect(tex.metalness, name).toBe(MATERIAL_PROPS[name].metalness);
    }
  });

  it('tiles seamlessly', () => {
    for (const name of ['concrete', 'stone', 'metal'] as const) {
      const l = createMaterialTexture(name, size).levels[0];
      const at = (x: number, y: number) => ((y % size) * size + (x % size)) * 4;
      const diff = (a: number, b: number) => Math.abs(l[a + 2] - l[b + 2]) + Math.abs(l[a + 3] - l[b + 3]);
      let edge = 0, inner = 0;
      for (let y = 0; y < size; y++) {
        edge += diff(at(size - 1, y), at(0, y));
        inner += diff(at(size / 2 - 1, y), at(size / 2, y));
      }
      // 端をまたいだ差が、内側の隣どうしの差と同程度（継ぎ目の溝がちょうど端に来る分は許す）
      expect(edge, name).toBeLessThan(inner * 3 + size * 40);
    }
  });

  it('gives each material its own character', () => {
    const concrete = stats('concrete'), stone = stats('stone'), metal = stats('metal');
    // コンクリート打ち放し: ほとんどが粗い面で、暗いセパ穴がある
    expect(concrete.share((p) => p.rough > 0.6)).toBeGreaterThan(0.9);
    expect(concrete.share((p) => p.cavity < 0.6)).toBeGreaterThan(0);
    // 石張り: 磨いた面（つやが強い）がほとんどで、目地がある
    expect(stone.share((p) => p.rough < 0.3)).toBeGreaterThan(0.8);
    expect(stone.share((p) => p.rough > 0.5)).toBeGreaterThan(0.005);
    // 金属パネル: 金属で、つやが強く、開いた目地は暗い
    expect(metal.tex.metalness).toBe(1);
    expect(metal.share((p) => p.rough < 0.35)).toBeGreaterThan(0.9);
    expect(metal.share((p) => p.cavity < 0.4)).toBeGreaterThan(0.002);
  });

  it('pulls exposed concrete toward gray', () => {
    const [r, g, b, amount] = MATERIAL_PROPS.concrete.tint;
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(0.05);
    expect(amount).toBeGreaterThan(0.5);
  });
});
