import { describe, expect, it } from 'vitest';
import { BuildingFacadeLayerError } from '../src/errors';
import { BuildingFacadeLayer } from '../src/layer/BuildingFacadeLayer';
import type { Point } from '../src/mesh/FacadeAnalyzer';
import { AVIATION_LIGHT_MIN_GENERATED_HEIGHT, createRng, generateRooftop, type RooftopInput } from '../src/mesh/RooftopGenerator';
import { DEFAULT_ROOF_OPTIONS, resolveRoofOptions } from '../src/roof/RoofOptions';
import { PRESET_STYLES } from '../src/style/presets';
import { validateLayerOptions } from '../src/layer/validateOptions';
import { DEFAULT_STYLE_RULES } from '../src/style/presets';

const rect = (x0: number, y0: number, x1: number, y1: number): Point[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

const office = (polygons: Point[][][], extra: Partial<RooftopInput> = {}): RooftopInput => ({
  polygons,
  height: 40,
  storeys: 10,
  category: 'office',
  openSided: false,
  seed: 0.42,
  ...extra,
});

const insidePolygon = ([x, y]: Point, ring: Point[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

describe('resolveRoofOptions', () => {
  it('fills defaults', () => {
    expect(resolveRoofOptions(undefined)).toEqual(DEFAULT_ROOF_OPTIONS);
  });

  it('accepts booleans and partial objects, and merges onto the current settings', () => {
    const a = resolveRoofOptions({ parapet: false, equipment: { density: 0.2 }, aviationLights: { minHeight: 100 } });
    expect(a.parapet).toEqual({ enabled: false, height: 0.9 });
    expect(a.equipment).toEqual({ enabled: true, density: 0.2 });
    expect(a.aviationLights.minHeight).toBe(100);
    expect(a.aviationLights.blink).toBe(true);

    const b = resolveRoofOptions({ parapet: true, aviationLights: { blink: false } }, a);
    expect(b.parapet.enabled).toBe(true);
    expect(b.equipment.density).toBe(0.2); // 既存の設定を保つ
    expect(b.aviationLights).toMatchObject({ minHeight: 100, blink: false, enabled: true });
  });

  it('rejects out-of-range values with an options error', () => {
    const bad = [
      { parapet: { height: 5 } },
      { equipment: { density: 1.5 } },
      { aviationLights: { intensity: -1 } },
      { aviationLights: { color: [1, 0, 2] as [number, number, number] } },
    ];
    for (const roof of bad) {
      try {
        resolveRoofOptions(roof);
        throw new Error('expected an error');
      } catch (e) {
        expect(e).toBeInstanceOf(BuildingFacadeLayerError);
        expect((e as BuildingFacadeLayerError).code).toBe('options');
      }
    }
  });
});

describe('BuildingFacadeLayer: roof', () => {
  const source = { type: 'geojson' as const, url: '/data.geojson' };
  it('exposes the resolved roof options and updates them with setRoof()', () => {
    const layer = new BuildingFacadeLayer({ id: 'w', source, roof: { equipment: false } });
    expect(layer.roof.equipment.enabled).toBe(false);
    layer.setRoof({ equipment: { density: 0.4 }, aviationLights: false });
    expect(layer.roof.equipment).toEqual({ enabled: true, density: 0.4 });
    expect(layer.roof.aviationLights.enabled).toBe(false);
    expect(layer.roof.parapet.enabled).toBe(true);
  });

  it('validates per-style roof fields', () => {
    expect(() =>
      validateLayerOptions({
        id: 'w',
        source,
        styles: { ...PRESET_STYLES, office: { ...PRESET_STYLES.office, rooftopEquipment: 3 } },
        styleRules: DEFAULT_STYLE_RULES,
      }),
    ).toThrow(/rooftopEquipment/);
  });
});

describe('generateRooftop', () => {
  it('is deterministic for the same seed', () => {
    const a = generateRooftop(office([[rect(0, 0, 40, 25)]]));
    const b = generateRooftop(office([[rect(0, 0, 40, 25)]]));
    expect(a).toEqual(b);
    expect(createRng(0.1)()).toBe(createRng(0.1)());
  });

  it('places equipment inside the roof, away from edges and without overlaps', () => {
    const ring = rect(0, 0, 40, 25);
    const { equipment, roofArea } = generateRooftop(office([[ring]]));
    expect(roofArea).toBeCloseTo(1000);
    expect(equipment.length).toBeGreaterThan(3);
    expect(equipment.some((e) => e.type === 'penthouse')).toBe(true);
    expect(equipment.some((e) => e.type === 'coolingTower')).toBe(true);
    for (const e of equipment) {
      for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        const p: Point = [e.x + (sx * e.w) / 2, e.y + (sy * e.d) / 2]; // 軸に沿った矩形（角度 0）
        expect(insidePolygon(p, ring)).toBe(true);
        expect(Math.min(p[0], 40 - p[0], p[1], 25 - p[1])).toBeGreaterThanOrEqual(0.8 - 1e-9);
      }
    }
    for (let i = 0; i < equipment.length; i++) {
      for (let j = i + 1; j < equipment.length; j++) {
        const a = equipment[i], b = equipment[j];
        const overlap = Math.abs(a.x - b.x) < (a.w + b.w) / 2 && Math.abs(a.y - b.y) < (a.d + b.d) / 2;
        expect(overlap).toBe(false);
      }
    }
  });

  it('keeps penthouses at a low rank so they survive low densities', () => {
    const { equipment } = generateRooftop(office([[rect(0, 0, 40, 25)]]));
    for (const e of equipment.filter((x) => x.type === 'penthouse')) expect(e.rank).toBeLessThan(0.1);
  });

  it('avoids courtyards', () => {
    const hole = [...rect(10, 10, 30, 30)].reverse();
    const { equipment } = generateRooftop(office([[rect(0, 0, 40, 40), hole]]));
    for (const e of equipment) expect(e.x > 10 && e.x < 30 && e.y > 10 && e.y < 30).toBe(false);
  });

  it('finds a rectangular solar area away from the edges and the equipment', () => {
    const ring = rect(0, 0, 40, 25);
    const { equipment, solarArea } = generateRooftop(office([[ring]]));
    expect(solarArea).toBeDefined();
    const [u0, v0, u1, v1] = solarArea!;
    // 主軸は x 方向（最も長い辺）なので、主軸座標系 = 局所座標
    expect(Math.min(u0, v0, 40 - u1, 25 - v1)).toBeGreaterThanOrEqual(1 - 0.5);
    expect((u1 - u0) * (v1 - v0)).toBeGreaterThan(100);
    for (const e of equipment) {
      const overlap = e.x + e.w / 2 > u0 && e.x - e.w / 2 < u1 && e.y + e.d / 2 > v0 && e.y - e.d / 2 < v1;
      expect(overlap).toBe(false);
    }
  });

  it('keeps the solar area inside an L-shaped roof', () => {
    const l: Point[] = [[0, 0], [30, 0], [30, 10], [10, 10], [10, 30], [0, 30]];
    const { solarArea } = generateRooftop(office([[l]], { storeys: 1, height: 5, category: 'house' }));
    const [u0, v0, u1, v1] = solarArea!;
    for (const c of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]] as Point[]) expect(insidePolygon(c, l)).toBe(true);
  });

  it('skips open-sided structures and tiny roofs', () => {
    expect(generateRooftop(office([[rect(0, 0, 20, 20)]], { openSided: true })).equipment).toHaveLength(0);
    expect(generateRooftop(office([[rect(0, 0, 3, 3)]])).equipment).toHaveLength(0);
  });

  it('puts aviation lights on up to four corners of tall buildings only', () => {
    const tall = generateRooftop(office([[rect(0, 0, 40, 25)]], { height: 80 }));
    expect(tall.lights).toHaveLength(4);
    for (const [x, y] of tall.lights) expect(Math.min(x, 40 - x) < 1 && Math.min(y, 25 - y) < 1).toBe(true);
    const low = generateRooftop(office([[rect(0, 0, 40, 25)]], { height: AVIATION_LIGHT_MIN_GENERATED_HEIGHT - 1 }));
    expect(low.lights).toHaveLength(0);
  });
});
