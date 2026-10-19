import type { BuildingRecord, FootprintGeometry } from '../model/BuildingRecord';

export interface AdapterContext {
  /** ソースの識別子（ログやデバッグ用） */
  sourceId: string;
}

/**
 * ソース固有の属性を共通モデルへ変換する。
 * Worker 内で実行されるため、組み込みアダプタは Worker バンドルに含めて名前で選ぶ。
 */
export interface BuildingAdapter {
  readonly name: string;
  /** 描画対象外にする場合は null */
  toRecord(props: Record<string, unknown>, geometry: FootprintGeometry, ctx: AdapterContext): BuildingRecord | null;
}

/** メインスレッドから Worker に渡す、アダプタの指定（JSON のみ） */
export type AdapterConfig =
  | { name: string; options?: Record<string, unknown> }
  | { name: 'declarative'; spec: import('./DeclarativeAdapter').DeclarativeAdapterSpec };

export type AdapterFactory = (options?: Record<string, unknown>) => BuildingAdapter;

// ---------------------------------------------------------------- helpers for adapter authors

/** 候補キーを順に試して、最初に見つかった値を返す */
export function pick(props: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = props[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/** 数値に変換する。欠損値（例: -9999, 9999）は undefined にする */
export function toNumber(v: unknown, missing: readonly (number | string)[] = []): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (missing.includes(v as number) || missing.includes(String(v))) return undefined;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || missing.includes(n)) return undefined;
  return n;
}
