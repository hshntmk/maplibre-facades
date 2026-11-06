import { mercatorX, mercatorY } from '../math/mercator';
import type { SourceFeature } from '../sources/SourceConfig';
import type { Point } from './FacadeAnalyzer';
import { hashU32, keyOf, mixKey } from './Frontage';
import { GROUND_STRIDE, TREE_STRIDE, type MeshReference } from './layout';

// PLATEAU の植生モデル（LOD1）から木を作る。LOD1 の植生は押し出した多角形なので、建物と同じく外形と高さ（_zmin / _zmax）を読む。
// - 単独木（veg:SolitaryVegetationObject）: 外形の重心に 1 本。樹冠の大きさは外形の面積と高さから決める
// - 植被（veg:PlantCover）: 多角形の中に木（高さ 2.5m 以上）か低木を、格子をずらして並べる
// 樹種の属性はほとんど「不明」なので、木ごとのキーから種類（落葉広葉樹・常緑広葉樹・針葉樹・桜）を選ぶ。

/** 木の種類（シェーダの色分けと合わせること） */
export const TREE_TYPES = { deciduous: 0, evergreen: 1, conifer: 2, cherry: 3, shrub: 4 } as const;

/** 単独木の種類の割合（%）: 落葉広葉樹・常緑広葉樹・針葉樹・桜の順に累積 */
const TREE_SHARES = [45, 75, 85];
/** 植被を低木として扱う高さ (m) */
const SHRUB_MAX_HEIGHT = 2.5;
/** 1 つの植被に並べる最大の本数、1 タイルの最大の本数 */
const MAX_PER_COVER = 3000;
const MAX_PER_TILE = 40000;

export interface VegetationResult {
  trees: Float32Array;
  grounds: Float32Array;
  /** 基準点からいちばん遠い木までの水平距離 (m) */
  radius: number;
  /** 範囲 [west, south, east, north]（度） */
  bounds: [number, number, number, number];
  count: number;
}

export function treeType(key: number): number {
  const p = hashU32(key) % 100;
  return p < TREE_SHARES[0] ? TREE_TYPES.deciduous : p < TREE_SHARES[1] ? TREE_TYPES.evergreen : p < TREE_SHARES[2] ? TREE_TYPES.conifer : TREE_TYPES.cherry;
}

function ringArea(ring: Point[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, y0] = ring[i];
    const [x1, y1] = ring[(i + 1) % ring.length];
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

function inside([x, y]: Point, ring: Point[]): boolean {
  let hit = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

const unit = (key: number, salt: number) => (mixKey(key, salt) % 100000) / 100000;

export function buildVegetation(features: SourceFeature[], reference: MeshReference): VegetationResult {
  const trees: number[] = [];
  const grounds: number[] = [];
  let radius = 0;
  const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
  const toLocal = ([lng, lat]: [number, number]): Point => [
    (mercatorX(lng) - reference.mercX) / reference.meterInMercator,
    -(mercatorY(lat) - reference.mercY) / reference.meterInMercator,
  ];
  const push = (x: number, y: number, height: number, crown: number, crownBase: number, type: number, key: number, ground: number) => {
    if (trees.length / TREE_STRIDE >= MAX_PER_TILE) return;
    trees.push(x, y, 0, height, crown, crownBase, type, (key % 100000) / 100000, ground);
    radius = Math.max(radius, Math.hypot(x, y) + crown);
  };

  for (const f of features) {
    if (f.geometry.kind !== 'footprint') continue;
    const id = String(f.properties.gml_id ?? f.properties.id ?? '');
    const key = keyOf(id);
    const zmin = Number(f.properties._zmin), zmax = Number(f.properties._zmax);
    const height = Number.isFinite(zmin) && Number.isFinite(zmax) ? zmax - zmin : 0;
    const type = String(f.properties.feature_type ?? '');
    for (const polygon of f.geometry.polygons) {
      for (const [lng, lat] of polygon[0]) {
        bounds[0] = Math.min(bounds[0], lng);
        bounds[1] = Math.min(bounds[1], lat);
        bounds[2] = Math.max(bounds[2], lng);
        bounds[3] = Math.max(bounds[3], lat);
      }
      const rings = polygon.map((r) => r.map(toLocal));
      const outer = rings[0];
      const area = Math.abs(ringArea(outer));
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const [x, y] of outer) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
      const ground = grounds.length / GROUND_STRIDE;
      grounds.push(minX, minY, maxX, maxY);

      if (!/PlantCover/.test(type)) {
        // 単独木: 重心に 1 本。樹冠は外形の大きさと、高さに見合う大きさのうち大きい方
        if (height < 1) continue;
        let cx = 0, cy = 0;
        for (const [x, y] of outer) {
          cx += x / outer.length;
          cy += y / outer.length;
        }
        const crown = Math.min(Math.max(Math.sqrt(area / Math.PI), height * 0.22, 1), 7);
        const t = treeType(key);
        const crownBase = height * (t === TREE_TYPES.conifer ? 0.15 : 0.3 + 0.1 * unit(key, 1));
        push(cx, cy, height, crown, crownBase, t, key, ground);
        continue;
      }

      // 植被: 格子をずらして並べる
      const shrub = height < SHRUB_MAX_HEIGHT;
      const spacing = shrub ? 1.6 : Math.max(4, height * 0.55);
      const count = area / (spacing * spacing);
      const step = count > MAX_PER_COVER ? spacing * Math.sqrt(count / MAX_PER_COVER) : spacing;
      let n = 0;
      for (let gy = minY + step / 2; gy < maxY; gy += step) {
        for (let gx = minX + step / 2; gx < maxX; gx += step) {
          const k = mixKey(key, (Math.round(gx * 10) * 73856093) ^ (Math.round(gy * 10) * 19349663));
          const p: Point = [gx + (unit(k, 2) - 0.5) * step * 0.7, gy + (unit(k, 3) - 0.5) * step * 0.7];
          if (!inside(p, outer) || rings.slice(1).some((h) => inside(p, h))) continue;
          if (shrub) {
            const h = Math.max(0.6, height) * (0.8 + 0.4 * unit(k, 4));
            push(p[0], p[1], h, step * (0.55 + 0.2 * unit(k, 5)), 0, TREE_TYPES.shrub, k, ground);
          } else {
            const h = height * (0.75 + 0.35 * unit(k, 4));
            const t = treeType(k);
            push(p[0], p[1], h, Math.min(step * (0.5 + 0.25 * unit(k, 5)), 7), h * (t === TREE_TYPES.conifer ? 0.15 : 0.3), t, k, ground);
          }
          n++;
        }
      }
      // 小さな植え込みにも 1 つは置く
      if (n === 0 && area > 0.5) {
        let cx = 0, cy = 0;
        for (const [x, y] of outer) {
          cx += x / outer.length;
          cy += y / outer.length;
        }
        push(cx, cy, Math.max(0.6, height), Math.max(0.6, Math.sqrt(area / Math.PI)), 0, shrub ? TREE_TYPES.shrub : treeType(key), key, ground);
      }
    }
  }
  return { trees: new Float32Array(trees), grounds: new Float32Array(grounds), radius, bounds, count: trees.length / TREE_STRIDE };
}
