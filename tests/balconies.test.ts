import { describe, expect, it } from 'vitest';
import { createAdapter } from '../src/adapters/registry';
import { enrich } from '../src/enrich/Enricher';
import type { FootprintGeometry } from '../src/model/BuildingRecord';
import { firstBalconyFloor, floorBase, floorLayout, runColumns, type BalconyLayout } from '../src/mesh/Balconies';
import { DEFAULT_EXPOSURE_THRESHOLDS, type SegmentFacade } from '../src/mesh/FacadeAnalyzer';
import { FacadeMeshBuilder, WALL_STRIDE, createReference } from '../src/mesh/FacadeMeshBuilder';
import { BALCONY_CEILING_DROP, BALCONY_FLOOR, BALCONY_PARTS, BALCONY_STRIDE } from '../src/mesh/layout';
import { balconyLayout } from '../src/style/FacadeStyle';
import { PRESET_STYLES } from '../src/style/presets';

const layout: BalconyLayout = { depth: 1.5, windowSpacing: 3.6, curtainWall: false, raisedGroundFloor: false, sunSideOnly: false, openAboveRatio: 0.6 };
const facade = (over: Partial<SegmentFacade> = {}): SegmentFacade => ({
  runOffset: 0,
  runLength: 12,
  runId: 0,
  clearance: 40,
  coverHeight: 0,
  sunSide: true,
  ...over,
});

describe('balcony layout', () => {
  it('splits floors like the facade shader', () => {
    // 高さ 30m・階高 3m: 上端のパラペット分 (0.9m) を除いて 9 階
    const plain = floorLayout(30, 3, false);
    expect(plain).toEqual({ floors: 9, groundHeight: 3, upperHeight: 3 });
    // 1 階を高くすると、残りを上の階で均等に割る
    const raised = floorLayout(30, 3, true);
    expect(raised.floors).toBe(9);
    expect(raised.groundHeight).toBeCloseTo(4.05);
    expect(floorBase(raised, 8) + raised.upperHeight).toBeCloseTo(27);
  });

  it('lays out window columns along a run', () => {
    const cols = runColumns(12, 3.6, false)!;
    expect(cols.margin).toBe(0.45);
    expect(cols.count).toBe(3);
    expect(cols.width).toBeCloseTo(3.7);
    expect(runColumns(-20, 4, false)?.margin).toBe(0); // 角のない閉じた面は余白なし
    expect(runColumns(1, 3.6, false)).toBeUndefined();
  });

  it('starts balconies on the first floor that is open', () => {
    const floors = floorLayout(30, 3, false);
    const t = DEFAULT_EXPOSURE_THRESHOLDS;
    expect(firstBalconyFloor(layout, facade(), 30, 0, floors, t)).toBe(1);
    expect(firstBalconyFloor({ ...layout, sunSideOnly: true }, facade({ sunSide: false }), 30, 0, floors, t)).toBe(0);
    expect(firstBalconyFloor({ ...layout, depth: 0 }, facade(), 30, 0, floors, t)).toBe(0);
    // 狭い隙間に面した壁は、ふさいでいる建物 (10m) より上の階から
    expect(firstBalconyFloor(layout, facade({ clearance: 2, coverHeight: 10 }), 30, 0, floors, t)).toBe(4);
    // 隣と接している壁は、隣が自分の高さ × openAboveRatio 以上なら開けない
    expect(firstBalconyFloor(layout, facade({ clearance: 0.2, coverHeight: 20 }), 30, 0, floors, t)).toBe(0);
    expect(firstBalconyFloor(layout, facade({ clearance: 0.2, coverHeight: 12 }), 30, 0, floors, t)).toBe(5);
  });

  it('takes the layout from the style', () => {
    expect(balconyLayout(PRESET_STYLES.apartment)).toMatchObject({ depth: 1.5, sunSideOnly: true });
    expect(balconyLayout(PRESET_STYLES.office).depth).toBe(0);
    expect(balconyLayout({ ...PRESET_STYLES.apartment, balconyDepth: 2 }).depth).toBe(2);
  });
});

describe('FacadeMeshBuilder balconies', () => {
  // 約 9m（東西）× 11m（南北）の 20m の建物
  const square: FootprintGeometry = {
    kind: 'footprint',
    polygons: [[[[139.77, 35.69], [139.7701, 35.69], [139.7701, 35.6901], [139.77, 35.6901]]]],
  };
  const record = enrich(createAdapter({ name: 'plateau' }).toRecord({ gml_id: 'apt', 'bldg:measuredHeight': 20 }, square, { sourceId: 'test' })!);
  const build = (balconies?: BalconyLayout[]) => {
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69), [], balconies);
    b.add(record, 0);
    return b.build();
  };

  it('adds nothing without a balcony layout', () => {
    const mesh = build();
    expect(mesh.walls.length / WALL_STRIDE).toBe(16);
    expect(mesh.balconies.length).toBe(0);
  });

  it('recesses the sun side behind the footprint', () => {
    const mesh = build([{ ...layout, sunSideOnly: true }]);
    const floors = floorLayout(20, record.floorHeight ?? 3.2, false);
    // 外壁 4 枚 + 日当たり面（南）の引っ込んだ壁 1 枚
    expect(mesh.walls.length / WALL_STRIDE).toBe(20);
    const wall = (q: number, k: number) => mesh.walls[(q * 4) * WALL_STRIDE + k];
    // 南の外壁はバルコニーあり（2 階から、奥行き +1.5）、他の外壁はなし
    expect([wall(0, 19), wall(0, 20)]).toEqual([1, 1.5]);
    expect([wall(1, 20), wall(2, 20), wall(3, 20)]).toEqual([0, 0, 0]);
    // 引っ込んだ壁は外壁の 1.5m 内側（北）で、2 階の床から最上階の天井まで
    const inner = 4 * 4 * WALL_STRIDE;
    expect(mesh.walls[inner + 20]).toBe(-1.5);
    expect(mesh.walls[inner + 1]).toBeCloseTo(1.5, 3);
    expect(mesh.walls[inner + 2]).toBeCloseTo(floorBase(floors, 1), 3);
    expect(mesh.walls[inner + 2 * WALL_STRIDE + 2]).toBeCloseTo(floorBase(floors, floors.floors - 1) + floors.upperHeight, 3);
    // 窓の位置がそろうよう、u は外壁と同じ（両端の余白の内側）
    expect(mesh.walls[inner + 3]).toBeCloseTo(0.45, 3);

    // 2 階から最上階まで、階ごとに床・天井・両端の袖壁（間口 9m では隔て板なし）
    const quads = mesh.balconies.length / BALCONY_STRIDE / 4;
    expect(quads).toBe((floors.floors - 1) * 4);
    expect(mesh.balconyIndices.length).toBe(quads * 6);
    const parts = new Set<number>();
    for (let i = 11; i < mesh.balconies.length; i += BALCONY_STRIDE) parts.add(mesh.balconies[i]);
    expect([...parts].sort()).toEqual([BALCONY_PARTS.floor, BALCONY_PARTS.ceiling, BALCONY_PARTS.sideWall]);
    // 2 階の床と天井の高さ
    expect(mesh.balconies[2]).toBeCloseTo(floorBase(floors, 1) + BALCONY_FLOOR, 3);
    expect(mesh.balconies[4 * BALCONY_STRIDE + 2]).toBeCloseTo(floorBase(floors, 1) + floors.upperHeight - BALCONY_CEILING_DROP, 3);
  });

  it('places partitions between dwellings on a long facade', () => {
    const long: FootprintGeometry = {
      kind: 'footprint',
      polygons: [[[[139.77, 35.69], [139.7703, 35.69], [139.7703, 35.6901], [139.77, 35.6901]]]],
    };
    const r = enrich(createAdapter({ name: 'plateau' }).toRecord({ gml_id: 'long', 'bldg:measuredHeight': 20 }, long, { sourceId: 'test' })!);
    const b = new FacadeMeshBuilder(createReference(139.77, 35.69), [], [{ ...layout, sunSideOnly: true }]);
    b.add(r, 0);
    const mesh = b.build();
    let partitions = 0;
    for (let i = 11; i < mesh.balconies.length; i += BALCONY_STRIDE * 4) if (mesh.balconies[i] === BALCONY_PARTS.partition) partitions++;
    const floors = floorLayout(20, r.floorHeight ?? 3.2, false);
    // 間口約 27m: 窓 7 列（約 3.73m）を 2 列（約 7.5m）ごとに仕切る → 3 枚
    expect(partitions).toBe(3 * (floors.floors - 1));
  });
});
