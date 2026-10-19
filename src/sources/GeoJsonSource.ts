import { BuildingWindowLayerError } from '../errors';
import type { GeoJsonSourceConfig, SourceFeature } from './SourceConfig';
import { openRing } from '../mesh/FacadeMeshBuilder';

export type { SourceFeature } from './SourceConfig';

interface GeoJsonFeature {
  type: 'Feature';
  id?: string | number;
  properties: Record<string, unknown> | null;
  geometry: { type: 'Polygon'; coordinates: number[][][] } | { type: 'MultiPolygon'; coordinates: number[][][][] } | null;
}

export async function* readGeoJsonSource(config: GeoJsonSourceConfig): AsyncGenerator<SourceFeature> {
  let fc: { features?: GeoJsonFeature[] };
  try {
    const res = await fetch(config.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    fc = await res.json();
  } catch (e) {
    throw new BuildingWindowLayerError('source', `Failed to load ${config.url}: ${e instanceof Error ? e.message : e}`, { cause: e });
  }
  if (!Array.isArray(fc.features)) throw new BuildingWindowLayerError('source', `${config.url} is not a GeoJSON FeatureCollection`);
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : [];
    if (!polys.length) continue;
    yield {
      properties: { ...(f.id !== undefined ? { id: f.id } : {}), ...(f.properties ?? {}) },
      geometry: { kind: 'footprint', polygons: polys.map((p) => p.map(openRing)) },
    };
  }
}
