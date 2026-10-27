import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { enrich } from '../src/enrich/Enricher';
import type { FootprintGeometry } from '../src/model/BuildingRecord';
import { FacadeMeshBuilder, WALL_STRIDE, createReference } from '../src/mesh/FacadeMeshBuilder';
import {
  FIXTURE_PARTS,
  GROUND_MODES,
  SHOP,
  apartmentPlan,
  hashU32,
  housePlan,
  keyOf,
  mixKey,
  shopType,
  tenantOf,
  type FrontageLayout,
} from '../src/mesh/Frontage';
import { FIXTURE_STRIDE } from '../src/mesh/layout';
import { frontageLayout } from '../src/style/FacadeStyle';
import { PRESET_STYLES } from '../src/style/presets';

describe('frontage decisions', () => {
  it('uses a 32-bit integer hash (same results as the shader)', () => {
    // 符号なし 32 ビットの範囲で、掛け算は 2^32 で折り返す（GLSL の uint と同じ）
    expect(hashU32(0)).toBe(0);
    expect(hashU32(1 + 2 ** 32)).toBe(hashU32(1));
    for (const x of [1, 2, 12345, 0xffffffff]) {
      const h = hashU32(x);
      expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    }
    expect(mixKey(5, 1)).not.toBe(mixKey(5, 2));
    // キーは float32 にそのまま入る 24 ビット
    expect(keyOf('bldg_1')).toBeLessThan(1 << 24);
    expect(Math.fround(keyOf('bldg_1'))).toBe(keyOf('bldg_1'));
  });

  it('splits a storefront run into contiguous tenants of 1–3 columns', () => {
    for (let run = 0; run < 50; run++) {
      const key = keyOf(`run${run}`);
      let c = 0;
      while (c < 9) {
        const t = tenantOf(key, c, 9);
        expect(t.start).toBe(c);
        expect(t.end - t.start).toBeLessThan(3);
        for (let k = t.start; k <= t.end; k++) expect(tenantOf(key, k, 9).key).toBe(t.key);
        c = t.end + 1;
      }
    }
  });

  it('mixes shop types in roughly the intended shares', () => {
    const counts = [0, 0, 0, 0, 0];
    for (let i = 0; i < 5000; i++) counts[shopType(hashU32(i))]++;
    expect(counts[SHOP.retail] / 5000).toBeCloseTo(0.38, 1);
    expect(counts[SHOP.restaurant] / 5000).toBeCloseTo(0.24, 1);
    expect(counts[SHOP.vacant] / 5000).toBeCloseTo(0.14, 1);
  });

  it('places the apartment entrance near the middle and parking at the far end', () => {
    for (let run = 0; run < 100; run++) {
      const { entrance, parking } = apartmentPlan(keyOf(`a${run}`), 6);
      expect(entrance).toBeGreaterThanOrEqual(1);
      expect(entrance).toBeLessThanOrEqual(3);
      if (parking[0] >= 0) expect(entrance < parking[0] || entrance > parking[1]).toBe(true);
    }
    expect(apartmentPlan(keyOf('narrow'), 3).parking).toEqual([-1, -1]);
  });

  it('puts the house garage away from the door', () => {
    for (let run = 0; run < 100; run++) {
      const { door, garage } = housePlan(keyOf(`h${run}`), 3, 9);
      if (garage >= 0) expect(garage).not.toBe(door);
    }
    expect(housePlan(keyOf('h'), 1, 4).garage).toBe(-1);
  });

  it('takes the ground floor mode from the style', () => {
    expect(frontageLayout(PRESET_STYLES.commercial).mode).toBe(GROUND_MODES.storefront);
    expect(frontageLayout(PRESET_STYLES.office).mode).toBe(GROUND_MODES.lobby);
    expect(frontageLayout(PRESET_STYLES.apartment).mode).toBe(GROUND_MODES.apartment);
    expect(frontageLayout(PRESET_STYLES.house).mode).toBe(GROUND_MODES.house);
  });
});

describe('FacadeMeshBuilder frontage', () => {
  // 約 27m（東西）× 11m（南北）の建物
  const long: FootprintGeometry = {
    kind: 'footprint',
    polygons: [[[[139.77, 35.69], [139.7703, 35.69], [139.7703, 35.6901], [139.77, 35.6901]]]],
  };
  const record = enrich(createAdapter({ name: 'plateau' }).toRecord({ gml_id: 'shop', 'bldg:measuredHeight': 15 }, long, { sourceId: 'test' })!);
  const layout = (mode: FrontageLayout['mode']): FrontageLayout => ({ mode, windowSpacing: 3.2, windowWidth: 0.5, curtainWall: false, sunSideOnly: false });
  const build = (frontages?: FrontageLayout[]) => {
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69), [], [], frontages);
    b.add(record, 0);
    return b.build();
  };
  const parts = (mesh: ReturnType<typeof build>) => {
    const set = new Set<number>();
    for (let i = 8; i < mesh.fixtures.length; i += FIXTURE_STRIDE) set.add(mesh.fixtures[i]);
    return set;
  };

  it('marks one entrance run and stores the frontage keys in the walls', () => {
    const mesh = build([layout(GROUND_MODES.lobby)]);
    const entrance = new Set<number>();
    const keys = new Set<number>();
    for (let i = 0; i < mesh.walls.length; i += WALL_STRIDE) {
      entrance.add(mesh.walls[i + 23]);
      keys.add(mesh.walls[i + 22]);
      expect(Number.isInteger(mesh.walls[i + 21])).toBe(true);
    }
    expect([...entrance].sort()).toEqual([0, 1]);
    expect([...keys]).toEqual([keyOf('shop')]);
    // ロビーの入口の庇
    expect(parts(mesh)).toEqual(new Set([FIXTURE_PARTS.canopy]));
  });

  it('builds awnings and projecting signs only for the tenants that have them', () => {
    const mesh = build([layout(GROUND_MODES.storefront)]);
    expect(mesh.fixtures.length % FIXTURE_STRIDE).toBe(0);
    expect(mesh.fixtureIndices.length).toBe((mesh.fixtures.length / FIXTURE_STRIDE / 4) * 6);
    for (const p of parts(mesh)) expect([FIXTURE_PARTS.awning, FIXTURE_PARTS.valance, FIXTURE_PARTS.sign, FIXTURE_PARTS.signEdge]).toContain(p);
  });

  it('adds nothing for the plain ground floor', () => {
    expect(build([layout(GROUND_MODES.same)]).fixtures.length).toBe(0);
    expect(build().fixtures.length).toBe(0);
  });
});
