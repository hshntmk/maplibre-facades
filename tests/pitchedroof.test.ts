import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { enrich } from '../src/enrich/Enricher';
import type { FootprintGeometry } from '../src/model/BuildingRecord';
import type { Point } from '../src/mesh/FacadeAnalyzer';
import { FacadeMeshBuilder, WALL_STRIDE, createReference } from '../src/mesh/FacadeMeshBuilder';
import { PITCHED_ROOF_STRIDE } from '../src/mesh/layout';
import { wallVertex, wallVertexCount } from './wallVertex';
import { minAreaRect, planPitchedRoof, ridgeSplits, roofSurfaceHeight, type PitchedRoofLayout, type RoofPlan } from '../src/mesh/PitchedRoof';
import { pitchedRoofLayout } from '../src/style/FacadeStyle';
import { PRESET_STYLES } from '../src/style/presets';

const rect = (w: number, d: number, angle = 0): Point[] => {
  const c = Math.cos(angle), s = Math.sin(angle);
  return ([[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]] as Point[]).map(([x, y]) => [x * c - y * s, x * s + y * c]);
};
const all = (shape: keyof Omit<PitchedRoofLayout, 'solarRatio'>): PitchedRoofLayout => ({ gable: 0, hip: 0, shed: 0, [shape]: 1, solarRatio: 0 });

describe('pitched roof plan', () => {
  it('finds the oriented bounding rectangle with u along the long side', () => {
    const r = minAreaRect(rect(10, 6, 0.4))!;
    expect(r.halfLength).toBeCloseTo(5);
    expect(r.halfWidth).toBeCloseTo(3);
    expect(Math.abs(Math.atan2(r.uy, r.ux))).toBeCloseTo(0.4);
  });

  it('roofs only near-rectangular single footprints', () => {
    const base = { id: 'h', bottom: 0, top: 7, layout: all('gable'), concrete: false, solarRatio: 0 };
    expect(planPitchedRoof({ ...base, rings: [[rect(10, 6)]] })?.shape).toBe('gable');
    // L 字（面積比 0.75）は陸屋根
    const l: Point[] = [[0, 0], [10, 0], [10, 4], [5, 4], [5, 8], [0, 8]];
    expect(planPitchedRoof({ ...base, rings: [[l]] })).toBeUndefined();
    expect(planPitchedRoof({ ...base, rings: [[rect(10, 6)], [rect(4, 4)]] })).toBeUndefined();
  });

  it('puts the ridge at the measured height and keeps the walls at least 2.4m', () => {
    const plan = planPitchedRoof({ id: 'h', rings: [[rect(10, 6)]], bottom: 0, top: 7, layout: all('gable'), concrete: false, solarRatio: 0 })!;
    expect(plan.ridge).toBe(7);
    expect(plan.eave).toBeCloseTo(7 - 3 * plan.pitch);
    // 低い建物は勾配を緩める
    const low = planPitchedRoof({ id: 'h', rings: [[rect(10, 8)]], bottom: 0, top: 3.6, layout: all('gable'), concrete: false, solarRatio: 0 })!;
    expect(low.eave).toBeGreaterThanOrEqual(2.4 - 1e-9);
    expect(low.pitch).toBeLessThan(0.4);
  });

  it('mixes shapes by the layout and halves pitched roofs on concrete houses', () => {
    const layout: PitchedRoofLayout = { gable: 0.4, hip: 0.3, shed: 0.2, solarRatio: 0 };
    const count = (concrete: boolean) => {
      const n = { gable: 0, hip: 0, shed: 0, flat: 0 };
      for (let i = 0; i < 2000; i++) {
        const p = planPitchedRoof({ id: `b${i}`, rings: [[rect(10, 7)]], bottom: 0, top: 8, layout, concrete, solarRatio: 0 });
        n[p ? p.shape : 'flat']++;
      }
      return n;
    };
    const wood = count(false);
    expect(wood.gable / 2000).toBeCloseTo(0.4, 1);
    expect(wood.flat / 2000).toBeCloseTo(0.1, 1);
    expect(count(true).flat / 2000).toBeCloseTo(0.55, 1);
  });

  it('follows the roof surface along the walls', () => {
    const plan: RoofPlan = { shape: 'gable', rect: minAreaRect(rect(10, 6))!, pitch: 0.5, ridge: 7.5, eave: 6, shedSign: 1, material: 0, color: 0, solar: false };
    // 軒側の壁は軒の高さ、妻側の壁の中央は棟の高さ
    expect(roofSurfaceHeight(plan, [0, -3])).toBeCloseTo(6);
    expect(roofSurfaceHeight(plan, [5, 0])).toBeCloseTo(7.5);
    expect(ridgeSplits(plan, [5, -3], [5, 3])).toEqual([0.5]);
    expect(ridgeSplits(plan, [-5, -3], [5, -3])).toEqual([]);
    const shed: RoofPlan = { ...plan, shape: 'shed', eave: 4.5 };
    expect(roofSurfaceHeight(shed, [0, -3])).toBeCloseTo(4.5);
    expect(roofSurfaceHeight(shed, [0, 3])).toBeCloseTo(7.5);
  });

  it('takes the layout from the style', () => {
    expect(pitchedRoofLayout(PRESET_STYLES.house)).toMatchObject({ gable: 0.4, hip: 0.3, shed: 0.18 });
    expect(pitchedRoofLayout(PRESET_STYLES.office)).toBeUndefined();
  });
});

describe('FacadeMeshBuilder pitched roofs', () => {
  // 約 9m × 11m、高さ 8m
  const square: FootprintGeometry = {
    kind: 'footprint',
    polygons: [[[[139.77, 35.69], [139.7701, 35.69], [139.7701, 35.6901], [139.77, 35.6901]]]],
  };
  const record = enrich(createAdapter({ name: 'plateau' }).toRecord({ gml_id: 'house', 'bldg:measuredHeight': 8, 'bldg:storeysAboveGround': 2 }, square, { sourceId: 'test' })!);

  it('lowers the walls to the eave, raises the gable ends and replaces the flat roof', () => {
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69), [], [], [], [all('gable')]);
    b.add(record, 0);
    const mesh = b.build();
    expect(mesh.roofs.length).toBe(0);
    expect(mesh.equipment.length).toBe(0);
    expect(mesh.pitchedRoofs.length).toBeGreaterThan(0);
    expect(mesh.pitchedRoofs.length % PITCHED_ROOF_STRIDE).toBe(0);
    // 妻側の 2 枚は棟で分かれるので、外壁は 6 枚
    expect(mesh.walls.length / WALL_STRIDE).toBe(24);
    const tops: number[] = [];
    for (let i = 0; i < wallVertexCount(mesh); i++) {
      const w = wallVertex(mesh, i);
      expect(w.flags & 2).toBe(2); // 勾配屋根の印（1 は入口のある面）
      tops.push(w.z);
    }
    expect(Math.max(...tops)).toBeCloseTo(8, 3);
    const eave = wallVertex(mesh, 0).height; // 軒までの高さ
    expect(eave).toBeLessThan(8);
    expect(eave).toBeGreaterThanOrEqual(2.4);
    // 階高は軒までの高さを 2 階で割った値
    expect(wallVertex(mesh, 0).floorHeight).toBeCloseTo(eave / 2, 3);
  });

  it('keeps the flat roof without a layout', () => {
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69));
    b.add(record, 0);
    const mesh = b.build();
    expect(mesh.pitchedRoofs.length).toBe(0);
    expect(mesh.roofs.length).toBeGreaterThan(0);
  });
});
