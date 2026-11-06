import { describe, expect, it } from 'vitest';
import { createReference } from '../src/mesh/FacadeMeshBuilder';
import { SIGNAL_STRIDE } from '../src/mesh/layout';
import { SIGNAL_PARTS, buildTrafficSignals } from '../src/mesh/TrafficSignals';
import type { SourceFeature } from '../src/sources/SourceConfig';
import { isFurnitureTile, isVegetationTile } from '../src/sources/tiles3d/Tileset';

const LNG = 139.77, LAT = 35.69;
const reference = createReference(LNG, LAT);
const M_LNG = 111320 * Math.cos((LAT * Math.PI) / 180), M_LAT = 110540;
/** 局所座標 (m) で中心 (x, y)、x 方向に w、y 方向に d の長方形 */
const rect = (x: number, y: number, w: number, d: number): [number, number][] => {
  const p = (px: number, py: number): [number, number] => [LNG + px / M_LNG, LAT + py / M_LAT];
  return [p(x - w / 2, y - d / 2), p(x + w / 2, y - d / 2), p(x + w / 2, y + d / 2), p(x - w / 2, y + d / 2)];
};
const feature = (code: string, ring: [number, number][], zmin: number, zmax: number, id: string): SourceFeature => ({
  properties: { feature_type: 'frn:CityFurniture', gml_id: id, _zmin: zmin, _zmax: zmax, attributes: { 'frn:function_code': code } },
  geometry: { kind: 'footprint', polygons: [[ring]] },
});
const read = (s: Float32Array, i: number) => {
  const o = i * SIGNAL_STRIDE;
  return { x: s[o], y: s[o + 1], z: s[o + 2], length: s[o + 3], depth: s[o + 4], height: s[o + 5], angle: s[o + 6], part: s[o + 7], group: s[o + 8], rows: s[o + 10] };
};
const all = (s: Float32Array) => Array.from({ length: s.length / SIGNAL_STRIDE }, (_, i) => read(s, i));
/** 灯面の向き（局所 +y を angle だけ回したもの） */
const faceOf = (angle: number) => [-Math.sin(angle), Math.cos(angle)];

// 地面の高さ 40m。交差点の中心は原点。北側の柱（腕木は x 方向）に横型の灯器、東側に歩行者用の灯器
const intersection = (): SourceFeature[] => [
  feature('4800', rect(-2, 10, 4.2, 0.4), 40, 47.6, 'pole_n'),
  feature('4900', rect(-3, 10, 1.15, 0.45), 45.6, 46.4, 'veh_n'),
  feature('4800', rect(10, 2, 0.4, 4.2), 40, 47.6, 'pole_e'),
  feature('4900', rect(10, 3, 0.45, 1.15), 45.6, 46.4, 'veh_e'),
  feature('4900', rect(10.5, 0.3, 0.28, 0.3), 43.2, 43.9, 'ped_e'),
  feature('4200', rect(0, -12, 0.4, 3), 40.1, 50, 'light'),
];

describe('buildTrafficSignals', () => {
  it('classifies heads by shape and puts them at their height above the ground', () => {
    const r = buildTrafficSignals(intersection(), reference);
    expect(r.count).toBe(3);
    const heads = all(r.signals).filter((p) => p.part !== SIGNAL_PARTS.pole);
    const veh = heads.filter((p) => p.part === SIGNAL_PARTS.vehicle);
    expect(veh.length).toBe(2);
    for (const h of veh) {
      expect(h.z).toBeCloseTo(5.6, 1);
      expect(h.length).toBeCloseTo(1.15, 1);
      // フードを含む外形より薄くする
      expect(h.depth).toBeCloseTo(0.3, 3);
      expect(h.rows).toBe(2);
    }
    const ped = heads.find((p) => p.part === SIGNAL_PARTS.pedestrian)!;
    expect(ped.z).toBeCloseTo(3.2, 1);
  });

  it('builds a pole at the far end of the arm and an arm along the heads', () => {
    const r = buildTrafficSignals(intersection(), reference);
    const metal = all(r.signals).filter((p) => p.part === SIGNAL_PARTS.pole);
    // 北の柱: 灯器（x = -3）から遠い東の端に立つ
    const north = metal.filter((p) => Math.abs(p.y - 10) < 0.5);
    const pole = north.find((p) => p.height > 7)!;
    const arm = north.find((p) => p.height < 0.5)!;
    expect(pole.x).toBeGreaterThan(-0.3);
    expect(pole.z).toBe(0);
    expect(arm.length).toBeCloseTo(4.2, 1);
    // 腕木は灯器の上端の高さ
    expect(arm.z).toBeCloseTo(6.4, 1);
  });

  it('faces vehicle heads away from the intersection and gives crossing directions different groups', () => {
    const r = buildTrafficSignals(intersection(), reference);
    const veh = all(r.signals).filter((p) => p.part === SIGNAL_PARTS.vehicle);
    const north = veh.find((p) => p.y > 5)!;
    const east = veh.find((p) => p.x > 5)!;
    expect(faceOf(north.angle)[1]).toBeCloseTo(1, 3);
    expect(faceOf(east.angle)[0]).toBeCloseTo(1, 3);
    expect(north.group).not.toBe(east.group);
  });

  it('turns back-to-back heads away from each other', () => {
    const r = buildTrafficSignals(
      [
        feature('4800', rect(2, 0, 5, 0.4), 40, 47.6, 'pole'),
        feature('4900', rect(0, 0.4, 1.15, 0.5), 45.6, 46.4, 'a'),
        feature('4900', rect(0, -0.4, 1.15, 0.5), 45.6, 46.4, 'b'),
      ],
      reference,
    );
    const veh = all(r.signals).filter((p) => p.part === SIGNAL_PARTS.vehicle);
    expect(veh.length).toBe(2);
    const [a, b] = veh.map((p) => faceOf(p.angle));
    expect(a[0] * b[0] + a[1] * b[1]).toBeCloseTo(-1, 3);
    // それぞれ自分のいる側を向く
    for (const p of veh) expect(Math.sign(faceOf(p.angle)[1])).toBe(Math.sign(p.y));
  });

  it('adds a slim pole under a head that has none, and ignores other furniture', () => {
    const r = buildTrafficSignals(
      [
        feature('4900', rect(0, 0, 0.28, 0.3), 43.2, 43.9, 'ped'),
        feature('4200', rect(3, 0, 0.4, 3), 40, 50, 'light'),
        feature('4100', rect(5, 0, 1, 1), 40, 42, 'sign'),
      ],
      reference,
    );
    expect(r.count).toBe(1);
    const parts = all(r.signals);
    expect(parts.length).toBe(2);
    const pole = parts.find((p) => p.part === SIGNAL_PARTS.pole)!;
    expect(pole.z).toBe(0);
    expect(pole.height).toBeGreaterThan(3.9);
  });
});

describe('furniture tiles', () => {
  it('are told apart from vegetation tiles by their id', () => {
    expect(isFurnitureTile('f0/1')).toBe(true);
    expect(isVegetationTile('f0/1')).toBe(false);
    expect(isFurnitureTile('t3/0')).toBe(false);
  });
});
