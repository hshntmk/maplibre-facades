import type { BuildingCategory, BuildingRecord, FootprintGeometry, StructureType } from '../model/BuildingRecord';
import { pick, toNumber, type AdapterContext, type BuildingAdapter } from './BuildingAdapter';

/**
 * JSON だけで定義できるアダプタ。Worker に渡せるので、ユーザー独自のデータソースに使う。
 * 例: OSM の building タグ → category
 */
export interface DeclarativeAdapterSpec {
  name: string;
  id: string[];
  height?: string[];
  minHeight?: string[];
  storeys?: string[];
  category?: { keys: string[]; map: Record<string, BuildingCategory>; default?: BuildingCategory };
  structure?: { keys: string[]; map: Record<string, StructureType> };
  missingValues?: (number | string)[];
  extras?: string[];
}

export function createDeclarativeAdapter(spec: DeclarativeAdapterSpec): BuildingAdapter {
  const missing = spec.missingValues ?? [];
  return {
    name: spec.name,
    toRecord(props, geometry: FootprintGeometry, ctx: AdapterContext): BuildingRecord | null {
      const id = pick(props, spec.id);
      if (id === undefined) return null;
      const height = toNumber(pick(props, spec.height ?? []), missing);
      const storeys = toNumber(pick(props, spec.storeys ?? []), missing);
      const rawCategory = spec.category ? pick(props, spec.category.keys) : undefined;
      const category =
        (rawCategory !== undefined ? spec.category?.map[String(rawCategory)] : undefined) ??
        spec.category?.default ??
        'unknown';
      const rawStructure = spec.structure ? pick(props, spec.structure.keys) : undefined;
      const extras: Record<string, string | number | boolean> = {};
      for (const k of spec.extras ?? []) {
        const v = props[k];
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') extras[k] = v;
      }
      return {
        id: String(id),
        geometry,
        height: height ?? 0,
        minHeight: toNumber(pick(props, spec.minHeight ?? []), missing) ?? 0,
        storeys,
        category,
        structure: (rawStructure !== undefined ? spec.structure?.map[String(rawStructure)] : undefined) ?? 'unknown',
        fireResistance: 'unknown',
        openSided: false,
        provenance: {
          source: ctx.sourceId,
          heightEstimated: height === undefined,
          storeysEstimated: storeys === undefined,
          categoryEstimated: category === 'unknown',
        },
        extras,
      };
    },
  };
}
