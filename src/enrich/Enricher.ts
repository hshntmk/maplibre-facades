import type { BuildingCategory, BuildingRecord } from '../model/BuildingRecord';

// どのデータソースにも共通の欠損補完。アダプタは「データに書いてあること」だけを返し、
// 推定はここに集約する（provenance に推定したかどうかを残す）。

const DEFAULT_FLOOR_HEIGHT: Partial<Record<BuildingCategory, number>> = {
  office: 3.8,
  commercial: 4.5,
  mixed_commercial: 4.2,
  hotel: 3.2,
  house: 2.9,
  apartment: 3.0,
  mixed_house: 3.1,
  mixed_apartment: 3.1,
  public: 4.0,
  education_welfare: 3.8,
  warehouse: 6.0,
  factory: 6.0,
  utility: 5.0,
};
const MAX_FLOOR_HEIGHT: Partial<Record<BuildingCategory, number>> = {
  warehouse: 12,
  factory: 12,
  utility: 10,
  commercial: 6.5,
  mixed_commercial: 6.5,
  public: 6,
  education_welfare: 6,
};
const MIN_FLOOR_HEIGHT = 2.5;

/** 屋上のパラペットなど、最上階の上にある窓のない部分の高さ */
export const parapetHeight = (height: number): number => Math.min(2.5, Math.max(0.4, height * 0.03));

export function enrich(input: BuildingRecord): BuildingRecord {
  const r: BuildingRecord = { ...input, provenance: { ...input.provenance } };
  const nominal = DEFAULT_FLOOR_HEIGHT[r.category] ?? 3.2;

  if (!(r.height > 0)) {
    r.height = (r.storeys ?? 2) * nominal + 0.6;
    r.provenance.heightEstimated = true;
  }

  // 階数がない大きな建物はオフィスとみなす（推定フラグを立てる）
  if (r.category === 'unknown' && !r.openSided && r.height >= 30) {
    r.category = 'office';
    r.provenance.categoryEstimated = true;
  }

  const usable = Math.max(r.height - parapetHeight(r.height), 1);
  if (r.storeys === undefined) {
    r.storeys = Math.max(1, Math.round(usable / nominal));
    r.provenance.storeysEstimated = true;
  }

  // データ上の階数と高さから実際の階高を出す。極端な値は丸め、表示上の階数を合わせる
  const max = MAX_FLOOR_HEIGHT[r.category] ?? 5.5;
  let fh = usable / r.storeys;
  if (fh > max) fh = usable / Math.ceil(usable / max);
  else if (fh < MIN_FLOOR_HEIGHT) fh = usable / Math.max(1, Math.floor(usable / MIN_FLOOR_HEIGHT));
  r.floorHeight = fh;
  return r;
}
