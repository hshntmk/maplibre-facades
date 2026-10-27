import { createAdapter } from '../adapters/registry';
import type { BuildingAdapter } from '../adapters/BuildingAdapter';
import { enrich } from '../enrich/Enricher';
import { BuildingFacadeLayerError } from '../errors';
import type { BuildingRecord } from '../model/BuildingRecord';
import { FacadeMeshBuilder, createReference } from '../mesh/FacadeMeshBuilder';
import type { FacadeMesh } from '../mesh/layout';
import type { SourceFeature } from '../sources/SourceConfig';
import { StyleResolver } from '../style/StyleResolver';
import type { BuildingStats, PipelineConfig } from './protocol';

// Source → Adapter → Enricher → StyleResolver → Mesh。Worker からもテストからも呼べるように分けてある。

export interface StyledRecord {
  record: BuildingRecord;
  style: number;
}

export type Bounds = [number, number, number, number];

/** 生の属性 → 共通モデル + スタイル番号 */
export class RecordFactory {
  private readonly adapter: BuildingAdapter;
  private readonly resolver: StyleResolver;

  constructor(readonly config: PipelineConfig) {
    this.adapter = createAdapter(config.adapter);
    this.resolver = new StyleResolver(config.styleRules, config.styleNames);
  }

  /** 変換できない建物と、ID が重複する建物は数えて捨てる */
  async build(features: AsyncIterable<SourceFeature> | Iterable<SourceFeature>, sourceId: string): Promise<{ records: StyledRecord[]; skipped: number }> {
    const records: StyledRecord[] = [];
    const seen = new Set<string>();
    let skipped = 0;
    for await (const f of features) {
      let raw: BuildingRecord | null;
      try {
        raw = this.adapter.toRecord(f.properties, f.geometry, { sourceId });
      } catch (e) {
        throw new BuildingFacadeLayerError('adapter', `Adapter "${this.adapter.name}" failed: ${e instanceof Error ? e.message : e}`, { cause: e });
      }
      if (!raw || seen.has(raw.id)) {
        skipped++;
        continue;
      }
      seen.add(raw.id);
      const record = enrich(raw);
      const style = this.resolver.resolve(record);
      if (style < 0) {
        skipped++;
        continue;
      }
      records.push({ record, style });
    }
    return { records, skipped };
  }
}

export function boundsOf(records: StyledRecord[]): Bounds {
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { record } of records) {
    for (const poly of record.geometry.polygons) {
      for (const [lng, lat] of poly[0]) {
        b[0] = Math.min(b[0], lng);
        b[1] = Math.min(b[1], lat);
        b[2] = Math.max(b[2], lng);
        b[3] = Math.max(b[3], lat);
      }
    }
  }
  return b;
}

/**
 * 建物をメッシュにする。obstacles（隣のタイルの建物など）は壁面の解析にだけ使い、描かない。
 */
export function meshRecords(records: StyledRecord[], obstacles: StyledRecord[], config: PipelineConfig, skipped = 0): { mesh: FacadeMesh; stats: BuildingStats } {
  const stats: BuildingStats = {
    total: 0,
    skipped,
    byCategory: {},
    byStyle: {},
    estimated: { height: 0, storeys: 0, category: 0 },
    facades: { front: 0, side: 0, party: 0, sunSide: 0 },
    bounds: boundsOf(records),
  };
  for (const { record, style } of records) {
    stats.total++;
    stats.byCategory[record.category] = (stats.byCategory[record.category] ?? 0) + 1;
    const name = config.styleNames[style];
    stats.byStyle[name] = (stats.byStyle[name] ?? 0) + 1;
    if (record.provenance.heightEstimated) stats.estimated.height++;
    if (record.provenance.storeysEstimated) stats.estimated.storeys++;
    if (record.provenance.categoryEstimated) stats.estimated.category++;
  }

  const [w, s, e, n] = Number.isFinite(stats.bounds[0]) ? stats.bounds : [0, 0, 0, 0];
  const builder = new FacadeMeshBuilder(createReference((w + e) / 2, (s + n) / 2), config.exposureThresholds, config.balconies, config.frontages);
  for (const { record, style } of records) builder.add(record, style);
  for (const { record, style } of obstacles) builder.add(record, style, { obstacle: true });
  const { facadeLengths, ...mesh } = builder.build();
  stats.facades = facadeLengths;
  return { mesh, stats };
}

/** すべての建物を 1 つのメッシュにする（GeoJSON・テスト用） */
export async function runBuildPipeline(
  features: AsyncIterable<SourceFeature> | Iterable<SourceFeature>,
  config: PipelineConfig,
  sourceId: string,
): Promise<{ mesh: FacadeMesh; stats: BuildingStats }> {
  const { records, skipped } = await new RecordFactory(config).build(features, sourceId);
  return meshRecords(records, [], config, skipped);
}
