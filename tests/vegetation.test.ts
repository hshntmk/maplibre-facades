import { describe, expect, it } from 'vitest';
import { createReference } from '../src/mesh/FacadeMeshBuilder';
import { TREE_STRIDE } from '../src/mesh/layout';
import { TREE_TYPES, buildVegetation, treeType } from '../src/mesh/Vegetation';
import { hashU32 } from '../src/mesh/Frontage';
import type { SourceFeature } from '../src/sources/SourceConfig';
import { isVegetationTile } from '../src/sources/tiles3d/Tileset';

const reference = createReference(139.77, 35.69);
/** 経度・緯度で約 w × d m の長方形 */
const rect = (w: number, d: number, lng = 139.77, lat = 35.69): [number, number][] => {
  const dx = w / (111320 * Math.cos((lat * Math.PI) / 180)), dy = d / 110540;
  return [[lng, lat], [lng + dx, lat], [lng + dx, lat + dy], [lng, lat + dy]];
};
const feature = (type: string, ring: [number, number][], zmin: number, zmax: number, id = 'veg_1'): SourceFeature => ({
  properties: { feature_type: type, gml_id: id, _zmin: zmin, _zmax: zmax },
  geometry: { kind: 'footprint', polygons: [[ring]] },
});
const read = (trees: Float32Array, i: number) => {
  const o = i * TREE_STRIDE;
  return { x: trees[o], y: trees[o + 1], height: trees[o + 3], crown: trees[o + 4], crownBase: trees[o + 5], type: trees[o + 6], ground: trees[o + 8] };
};

describe('buildVegetation', () => {
  it('places one tree at the centre of a solitary tree footprint', () => {
    const v = buildVegetation([feature('veg:SolitaryVegetationObject', rect(3, 3), 40, 50)], reference);
    expect(v.count).toBe(1);
    const t = read(v.trees, 0);
    expect(t.x).toBeCloseTo(1.5, 1);
    expect(t.y).toBeCloseTo(1.5, 1);
    expect(t.height).toBeCloseTo(10);
    // 樹冠は外形（半径約 1.7m）より、高さに見合う大きさ（10m × 0.22）が大きい
    expect(t.crown).toBeCloseTo(2.2, 1);
    expect(t.crownBase).toBeGreaterThan(0);
    expect(t.crownBase).toBeLessThan(t.height);
    expect(v.grounds.length).toBe(4);
  });

  it('fills a plant cover with shrubs or trees depending on its height', () => {
    const low = buildVegetation([feature('veg:PlantCover', rect(20, 10), 40, 41.2)], reference);
    expect(low.count).toBeGreaterThan(40);
    for (let i = 0; i < low.count; i++) {
      const t = read(low.trees, i);
      expect(t.type).toBe(TREE_TYPES.shrub);
      expect(t.x).toBeGreaterThanOrEqual(0);
      expect(t.x).toBeLessThanOrEqual(20);
      expect(t.ground).toBe(0); // 植被ごとに 1 つ
    }
    const tall = buildVegetation([feature('veg:PlantCover', rect(40, 40), 40, 52)], reference);
    expect(tall.count).toBeGreaterThan(10);
    expect(tall.count).toBeLessThan(200);
    for (let i = 0; i < tall.count; i++) expect(read(tall.trees, i).type).not.toBe(TREE_TYPES.shrub);
  });

  it('caps the number of trees in a large cover', () => {
    const v = buildVegetation([feature('veg:PlantCover', rect(1000, 1000), 0, 1)], reference);
    expect(v.count).toBeLessThanOrEqual(3000 * 1.1);
  });

  it('mixes tree types and skips trees that are too low', () => {
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[treeType(hashU32(i))]++;
    expect(counts[TREE_TYPES.deciduous] / 4000).toBeCloseTo(0.45, 1);
    expect(counts[TREE_TYPES.cherry] / 4000).toBeCloseTo(0.15, 1);
    expect(buildVegetation([feature('veg:SolitaryVegetationObject', rect(2, 2), 40, 40.5)], reference).count).toBe(0);
  });

  it('marks vegetation tiles by their id', () => {
    expect(isVegetationTile('v3/0/1')).toBe(true);
    expect(isVegetationTile('t3/0/1')).toBe(false);
    expect(isVegetationTile('r/0')).toBe(false);
  });
});
