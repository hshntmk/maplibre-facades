import type { LngLatRing } from '../../model/BuildingRecord';
import type { SourceFeature } from '../SourceConfig';
import type { TileContent } from './content';

// LOD1 の建物（角柱）のメッシュから、フットプリントと高さを復元する。
// 屋根面（水平で最上部の三角形）の境界辺をつないでリングにし、ほぼ一直線の頂点を間引く。

const A = 6378137.0;
const F = 1 / 298.257223563;
const E2 = F * (2 - F);
const B = A * (1 - F);
const EP2 = (A * A - B * B) / (B * B);

/** ECEF → [経度, 緯度, 楕円体高] */
export function ecefToGeodetic(x: number, y: number, z: number): [number, number, number] {
  const p = Math.hypot(x, y);
  const th = Math.atan2(z * A, p * B);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + EP2 * B * Math.sin(th) ** 3, p - E2 * A * Math.cos(th) ** 3);
  const N = A / Math.sqrt(1 - E2 * Math.sin(lat) ** 2);
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI, p / Math.cos(lat) - N];
}

type Geo = [number, number, number];

interface Footprint {
  polygons: LngLatRing[][];
  /** 屋根面と最下部の高さ (m、楕円体高) */
  top: number;
  bottom: number;
}

function pointInRing([x, y]: [number, number], ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** ほぼ一直線の頂点と極端に短い辺を除き、壁セグメントの分断を防ぐ */
function simplifyRing(ring: Geo[], toLocal: (g: Geo) => [number, number]): Geo[] {
  let pts = ring;
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    const out: Geo[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = toLocal(pts[(i - 1 + pts.length) % pts.length]);
      const b = toLocal(pts[i]);
      const c = toLocal(pts[(i + 1) % pts.length]);
      const abx = b[0] - a[0], aby = b[1] - a[1];
      const bcx = c[0] - b[0], bcy = c[1] - b[1];
      const lab = Math.hypot(abx, aby), lbc = Math.hypot(bcx, bcy);
      const cross = (abx * bcy - aby * bcx) / (lab * lbc || 1);
      if (lab < 0.05 || Math.abs(cross) < 0.02) {
        changed = true;
        continue;
      }
      out.push(pts[i]);
    }
    if (out.length < 3) break;
    pts = out;
  }
  return pts;
}

/** 凸包（反時計回り、Andrew の単調鎖） */
function convexHull(points: Geo[], toLocal: (g: Geo) => [number, number]): Geo[] {
  const pts = points.map((g) => ({ g, p: toLocal(g) })).sort((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  if (pts.length < 3) return pts.map((x) => x.g);
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: typeof pts) => {
    const out: typeof pts = [];
    for (const x of list) {
      while (out.length >= 2 && cross(out[out.length - 2].p, out[out.length - 1].p, x.p) <= 0) out.pop();
      out.push(x);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())].map((x) => x.g);
}

export function extractFootprint(tris: number[], geo: Geo[]): Footprint | null {
  const ref = geo[tris[0]];
  const lat0 = (ref[1] * Math.PI) / 180;
  const mx = (Math.PI / 180) * A * Math.cos(lat0);
  const my = (Math.PI / 180) * A;
  const toLocal = (g: Geo): [number, number] => [(g[0] - ref[0]) * mx, (g[1] - ref[1]) * my];

  let maxH = -Infinity, minH = Infinity;
  for (const i of tris) {
    maxH = Math.max(maxH, geo[i][2]);
    minH = Math.min(minH, geo[i][2]);
  }

  // 屋根 = 最上部にある三角形。量子化（Draco）された座標では平らな屋根の高さもばらつくので、
  // 許容幅は建物の高さの 25%（0.3〜1.5m）にする
  const roofTolerance = Math.min(1.5, Math.max(0.3, (maxH - minH) * 0.25));
  const roof: Geo[][] = [];
  for (let t = 0; t < tris.length; t += 3) {
    const g = [geo[tris[t]], geo[tris[t + 1]], geo[tris[t + 2]]];
    if (g.every((v) => Math.abs(v[2] - maxH) <= roofTolerance)) roof.push(g);
  }
  if (!roof.length) return null;

  // ほぼ一直線の細い三角形は、量子化で向きが反転して輪郭の辺が打ち消し合わなくなる。
  // まず幅 5cm 未満だけを捨てて試し、輪郭が閉じなければ幅 25cm 未満まで捨てて試す（量子化の粗い、遠景用のタイル）。
  // それでも駄目なら屋根の頂点の凸包で代用する
  const polygons = roofOutline(roof, toLocal, 0.05) ?? roofOutline(roof, toLocal, 0.25);
  if (polygons) return { polygons, top: maxH, bottom: minH };
  const hull = convexHull(roof.flat(), toLocal);
  return hull.length >= 3 ? { polygons: [[hull.map((g) => [g[0], g[1]] as [number, number])]], top: maxH, bottom: minH } : null;
}

/**
 * 屋根の三角形を上から見て反時計回りにそろえ、内部辺を打ち消して輪郭（外周と穴）を作る。輪郭が閉じなければ null
 * @param minWidth これより幅（最長辺からの高さ, m）の小さい三角形は捨てる。捨てても、その辺は隣の三角形の辺として残る
 */
function roofOutline(roof: Geo[][], toLocal: (g: Geo) => [number, number], minWidth: number): [number, number][][][] | null {
  const keyOf = (g: Geo) => {
    const [x, y] = toLocal(g);
    return `${Math.round(x * 50)},${Math.round(y * 50)}`; // 2cm で溶接
  };
  const coordOf = new Map<string, Geo>();
  const edges = new Set<string>();
  for (const g of roof) {
    const p = g.map(toLocal);
    const area2 = (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    const longest = Math.max(Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]), Math.hypot(p[0][0] - p[2][0], p[0][1] - p[2][1]));
    if (Math.abs(area2) < 1e-6 || Math.abs(area2) / longest < minWidth) continue;
    const ks = g.map(keyOf);
    if (ks[0] === ks[1] || ks[1] === ks[2] || ks[0] === ks[2]) continue;
    ks.forEach((k, j) => coordOf.set(k, g[j]));
    const order = area2 > 0 ? [0, 1, 2] : [0, 2, 1];
    for (let j = 0; j < 3; j++) {
      const a = ks[order[j]], b = ks[order[(j + 1) % 3]];
      const rev = `${b}|${a}`;
      if (edges.has(rev)) edges.delete(rev);
      else edges.add(`${a}|${b}`);
    }
  }
  if (edges.size < 3) return null;
  const next = new Map<string, string[]>();
  for (const e of edges) {
    const [a, b] = e.split('|');
    if (!next.has(a)) next.set(a, []);
    next.get(a)!.push(b);
  }
  const rings: Geo[][] = [];
  for (const start of [...next.keys()]) {
    while (next.get(start)?.length) {
      const ring = [start];
      let cur = next.get(start)!.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 100000) {
        ring.push(cur);
        const outs = next.get(cur);
        if (!outs?.length) break;
        cur = outs.pop()!;
      }
      // 途中で切れた輪郭がある = 三角形が折り重なっている。一部だけ閉じた輪郭を使うと形を誤るので失敗にする
      if (cur !== start) return null;
      if (ring.length >= 3) rings.push(ring.map((k) => coordOf.get(k)!));
    }
  }

  const signedArea = (ring: Geo[]) => {
    let s = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, y0] = toLocal(ring[i]);
      const [x1, y1] = toLocal(ring[(i + 1) % ring.length]);
      s += x0 * y1 - x1 * y0;
    }
    return s / 2;
  };
  const simplified = rings.map((r) => simplifyRing(r, toLocal)).filter((r) => r.length >= 3);
  const outers = simplified.filter((r) => signedArea(r) > 0).sort((a, b) => signedArea(b) - signedArea(a));
  const holes = simplified.filter((r) => signedArea(r) < 0);
  if (!outers.length) return null;
  const polys: Geo[][][] = outers.map((o) => [o]);
  for (const h of holes) {
    const target = polys.find((p) => pointInRing(toLocal(h[0]), p[0].map(toLocal))) ?? polys[0];
    target.push(h);
  }
  return polys.map((p) => p.map((ring) => ring.map((g) => [g[0], g[1]] as [number, number])));
}

/** バッチ（建物）ごとの属性。スカラー値はそのまま、ネストした attributes は JSON を解釈して渡す */
function batchProperties(table: Record<string, unknown[]>, i: number): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(table)) {
    const v = values[i];
    if (v === null || v === undefined) continue;
    if (key === 'attributes') {
      props.attributes = typeof v === 'string' ? safeParse(v) : v;
    } else if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
      props[key] = v;
    }
  }
  return props;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/** タイル（b3dm / glb）の中身を、建物ごとのフットプリント + 属性に変換する */
export function featuresFromTile(content: TileContent): SourceFeature[] {
  const byBatch = new Map<number, { tris: number[]; geo: Geo[]; index: Map<number, number> }>();
  for (const { positions, batchIds, indices } of content.meshes) {
    const geoCache = new Map<number, Geo>();
    const geoOf = (v: number) => {
      let g = geoCache.get(v);
      if (!g) {
        g = ecefToGeodetic(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        geoCache.set(v, g);
      }
      return g;
    };
    for (let t = 0; t < indices.length; t += 3) {
      const bid = Math.round(batchIds[indices[t]]);
      if (bid < 0 || bid >= content.batchLength) continue;
      let entry = byBatch.get(bid);
      if (!entry) byBatch.set(bid, (entry = { tris: [], geo: [], index: new Map() }));
      for (let j = 0; j < 3; j++) {
        const v = indices[t + j];
        let local = entry.index.get(v);
        if (local === undefined) {
          local = entry.geo.length;
          entry.geo.push(geoOf(v));
          entry.index.set(v, local);
        }
        entry.tris.push(local);
      }
    }
  }

  const features: SourceFeature[] = [];
  for (const [bid, { tris, geo }] of byBatch) {
    const fp = extractFootprint(tris, geo);
    if (!fp) continue;
    const properties = batchProperties(content.batchTable, bid);
    // バッチテーブルに高さの範囲がなければメッシュから補う（PLATEAU は _zmin / _zmax を持つ）
    if (properties._zmin === undefined) properties._zmin = fp.bottom;
    if (properties._zmax === undefined) properties._zmax = fp.top;
    features.push({ properties, geometry: { kind: 'footprint', polygons: fp.polygons } });
  }
  return features;
}
