import { readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { enrich } from '../src/enrich/Enricher';
import type { FootprintGeometry } from '../src/model/BuildingRecord';
import { FacadeMeshBuilder, ROOF_STRIDE, WALL_STRIDE, createReference } from '../src/mesh/FacadeMeshBuilder';
import { GROUND_STRIDE } from '../src/mesh/layout';
import { DEFAULT_STYLE_RULES, PRESET_STYLES } from '../src/style/presets';
import { StyleResolver } from '../src/style/StyleResolver';
import { runBuildPipeline } from '../src/worker/buildPipeline';
import type { SourceFeature } from '../src/sources/SourceConfig';

const square: FootprintGeometry = {
  kind: 'footprint',
  polygons: [[[[139.77, 35.69], [139.7701, 35.69], [139.7701, 35.6901], [139.77, 35.6901]]]],
};
const ctx = { sourceId: 'test' };
const plateau = createAdapter({ name: 'plateau' });
const styleNames = Object.keys(PRESET_STYLES);
const resolver = new StyleResolver(DEFAULT_STYLE_RULES, styleNames);

describe('PlateauAdapter', () => {
  it('maps usage codes and labels to common categories', () => {
    expect(plateau.toRecord({ gml_id: 'a', 'bldg:usage_code': '401' }, square, ctx)?.category).toBe('office');
    expect(plateau.toRecord({ gml_id: 'b', 'bldg:usage': '共同住宅' }, square, ctx)?.category).toBe('apartment');
    expect(plateau.toRecord({ gml_id: 'c', 'bldg:usage': '店舗等併用住宅' }, square, ctx)?.category).toBe('mixed_house');
  });

  it('refines "その他" with detailed usage', () => {
    const r = plateau.toRecord(
      { gml_id: 'd', 'bldg:usage': 'その他', 'uro:BuildingDetailAttribute_uro:detailedUsage': '医療施設' },
      square,
      ctx,
    );
    expect(r?.category).toBe('education_welfare');
  });

  it('treats 9999 / -9999 as missing and falls back to LOD1 extents', () => {
    const r = plateau.toRecord(
      { gml_id: 'e', 'bldg:storeysAboveGround': 9999, 'bldg:measuredHeight': -9999, _zmin: 3, _zmax: 15 },
      square,
      ctx,
    )!;
    expect(r.storeys).toBeUndefined();
    expect(r.height).toBe(12);
    expect(r.provenance.heightEstimated).toBe(true);
  });

  it('reads fire resistance and Tokyo structure codes', () => {
    const r = plateau.toRecord(
      { gml_id: 'f', 'uro:BuildingDetailAttribute_uro:fireproofStructureType': '準耐火造', 'uro:KeyValuePairAttribute_建物構造コード': '木造' },
      square,
      ctx,
    )!;
    expect(r.fireResistance).toBe('quasi_fireproof');
    expect(r.structure).toBe('wood');
  });

  it('marks 無壁舎 as open-sided', () => {
    expect(plateau.toRecord({ gml_id: 'g', 'bldg:class': '普通無壁舎' }, square, ctx)?.openSided).toBe(true);
  });
});

describe('Enricher', () => {
  it('derives floor height from height and storeys', () => {
    const r = enrich(plateau.toRecord({ gml_id: 'h', 'bldg:usage_code': '401', 'bldg:measuredHeight': 40, 'bldg:storeysAboveGround': 10 }, square, ctx)!);
    expect(r.floorHeight).toBeGreaterThan(3.5);
    expect(r.floorHeight).toBeLessThan(4);
  });

  it('clamps implausible floor heights', () => {
    // 7 階建てで 48.8m（屋上設備込み）の商業施設
    const r = enrich(plateau.toRecord({ gml_id: 'i', 'bldg:usage_code': '402', 'bldg:measuredHeight': 48.8, 'bldg:storeysAboveGround': 7 }, square, ctx)!);
    expect(r.floorHeight).toBeLessThanOrEqual(6.5);
  });

  it('estimates storeys when missing', () => {
    const r = enrich(plateau.toRecord({ gml_id: 'j', 'bldg:usage_code': '412', 'bldg:measuredHeight': 30 }, square, ctx)!);
    expect(r.storeys).toBe(10);
    expect(r.provenance.storeysEstimated).toBe(true);
  });
});

describe('StyleResolver', () => {
  const styleOf = (props: Record<string, unknown>) =>
    styleNames[resolver.resolve(enrich(plateau.toRecord({ gml_id: 'x', ...props }, square, ctx)!))];

  it('selects styles from common-model attributes only', () => {
    expect(styleOf({ 'bldg:usage_code': '401', 'bldg:measuredHeight': 150, 'bldg:storeysAboveGround': 35 })).toBe('curtainWall');
    expect(styleOf({ 'bldg:usage_code': '401', 'bldg:measuredHeight': 30, 'bldg:storeysAboveGround': 8 })).toBe('office');
    expect(styleOf({ 'bldg:usage_code': '411', 'bldg:measuredHeight': 8, 'bldg:storeysAboveGround': 2 })).toBe('house');
    expect(styleOf({ 'bldg:usage_code': '413', 'bldg:measuredHeight': 12, 'bldg:storeysAboveGround': 4 })).toBe('mixed');
    expect(styleOf({ 'bldg:class': '普通無壁舎', 'bldg:measuredHeight': 4 })).toBe('plain');
  });
});

describe('buildingAge', () => {
  it('maps construction year to 0 (new) .. 1 (50+ years), unknown to -1', async () => {
    const { buildingAge } = await import('../src/mesh/FacadeMeshBuilder');
    expect(buildingAge(undefined, 2026)).toBe(-1);
    expect(buildingAge(2026, 2026)).toBe(0);
    expect(buildingAge(2001, 2026)).toBeCloseTo(0.5);
    expect(buildingAge(1950, 2026)).toBe(1);
    expect(buildingAge(2100, 2026)).toBe(-1);
  });
});

describe('FacadeMeshBuilder', () => {
  it('emits one quad per wall segment with outward-facing tangents', () => {
    const record = enrich(plateau.toRecord({ gml_id: 'k', 'bldg:measuredHeight': 20 }, square, ctx)!);
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69));
    b.add(record, 0);
    const mesh = b.build();
    expect(mesh.walls.length / WALL_STRIDE).toBe(16); // 4 辺 × 4 頂点
    expect(mesh.wallIndices.length).toBe(24);
    expect(mesh.roofIndices.length).toBe(6);
    // 最初の辺（南側、西→東）の外向き法線 (ty, -tx) は南向き
    const tx = mesh.walls[5];
    const ty = mesh.walls[6];
    expect(tx).toBeCloseTo(1, 3);
    expect(-tx).toBeLessThan(0);
    expect(ty).toBeCloseTo(0, 3);
    // 壁の長さ ≈ 0.0001° × 経度方向の距離
    expect(mesh.walls[7]).toBeGreaterThan(8.5);
    expect(mesh.walls[7]).toBeLessThan(9.5);
  });

  it('numbers buildings for terrain elevation and gives their bounding boxes', () => {
    const a = enrich(plateau.toRecord({ gml_id: 'g1', 'bldg:measuredHeight': 20 }, square, ctx)!);
    const shifted: FootprintGeometry = { kind: 'footprint', polygons: [square.polygons[0].map((r) => r.map(([x, y]) => [x + 0.001, y] as [number, number]))] };
    const b2 = enrich(plateau.toRecord({ gml_id: 'g2', 'bldg:measuredHeight': 30 }, shifted, ctx)!);
    const obstacle = enrich(plateau.toRecord({ gml_id: 'g3', 'bldg:measuredHeight': 30 }, shifted, ctx)!);
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69));
    b.add(a, 0);
    b.add(obstacle, 0, { obstacle: true }); // 隣のタイルの建物は番号を使わない
    b.add(b2, 0);
    const mesh = b.build();
    expect(mesh.grounds.length).toBe(2 * GROUND_STRIDE);
    // 1 つ目は基準点を南西の角とする約 9m × 11m の矩形
    const [minX, minY, maxX, maxY] = mesh.grounds;
    expect(minX).toBeCloseTo(0, 3);
    expect(minY).toBeCloseTo(0, 3);
    expect(maxX).toBeGreaterThan(8.5);
    expect(maxY).toBeGreaterThan(10.5);
    // 頂点の 18 番目の値が建物の番号
    const wallSlots = new Set<number>();
    for (let i = 18; i < mesh.walls.length; i += WALL_STRIDE) wallSlots.add(mesh.walls[i]);
    expect([...wallSlots].sort()).toEqual([0, 1]);
    expect(mesh.roofs[ROOF_STRIDE - 1]).toBe(0);
    expect(mesh.roofs[mesh.roofs.length - 1]).toBe(1);
  });
});

const DATA = 'examples/chiyoda/public/data/13101_bldg_lod1.geojson';
describe.runIf(existsSync(DATA))('Chiyoda dataset', () => {
  it('builds the whole ward through the pipeline', async () => {
    const fc = JSON.parse(readFileSync(DATA, 'utf8'));
    const features: SourceFeature[] = fc.features.map((f: { properties: Record<string, unknown>; geometry: { coordinates: number[][][] } }) => ({
      properties: f.properties,
      geometry: { kind: 'footprint', polygons: [f.geometry.coordinates.map((r) => r.slice(0, -1))] },
    }));
    const { mesh, stats } = await runBuildPipeline(features, { adapter: { name: 'plateau' }, styleRules: DEFAULT_STYLE_RULES, styleNames }, 'chiyoda');
    console.log(JSON.stringify(stats, null, 1));
    console.log(`walls: ${mesh.walls.length / WALL_STRIDE} verts, ${(mesh.walls.byteLength / 1e6).toFixed(1)} MB`);
    console.log(`rooftop: ${mesh.equipment.length / 12} equipment, ${mesh.lights.length / 5} aviation light points`);
    expect(stats.total).toBeGreaterThan(12000);
    expect(stats.byCategory.office).toBeGreaterThan(4000);
    expect(stats.byStyle.curtainWall).toBeGreaterThan(50);
  }, 60000);
});
