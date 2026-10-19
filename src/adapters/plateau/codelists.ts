import type { BuildingCategory, FireResistance, StructureType } from '../../model/BuildingRecord';

// PLATEAU のコードリストから共通モデルへの対応表。
// 変換ツールによってコード（'401'）と名称（'業務施設'）のどちらが出るかが異なるので、両方を引けるようにする。

/** bldg:usage（Building_usage.xml） */
export const USAGE: Record<string, { label: string; category: BuildingCategory }> = {
  '401': { label: '業務施設', category: 'office' },
  '402': { label: '商業施設', category: 'commercial' },
  '403': { label: '宿泊施設', category: 'hotel' },
  '404': { label: '商業系複合施設', category: 'mixed_commercial' },
  '411': { label: '住宅', category: 'house' },
  '412': { label: '共同住宅', category: 'apartment' },
  '413': { label: '店舗等併用住宅', category: 'mixed_house' },
  '414': { label: '店舗等併用共同住宅', category: 'mixed_apartment' },
  '415': { label: '作業所併用住宅', category: 'mixed_house' },
  '421': { label: '官公庁施設', category: 'public' },
  '422': { label: '文教厚生施設', category: 'education_welfare' },
  '431': { label: '運輸倉庫施設', category: 'warehouse' },
  '441': { label: '工場', category: 'factory' },
  '451': { label: '農林漁業用施設', category: 'other' },
  '452': { label: '供給処理施設', category: 'utility' },
  '453': { label: '防衛施設', category: 'other' },
  '454': { label: 'その他', category: 'other' },
  '461': { label: '不明', category: 'unknown' },
};

export const USAGE_BY_LABEL: Record<string, BuildingCategory> = Object.fromEntries(
  Object.values(USAGE).map((u) => [u.label, u.category]),
);

/**
 * uro:detailedUsage（都市計画基礎調査の詳細用途）による補正。
 * bldg:usage が「その他」「不明」の場合に使う。
 */
export const DETAILED_USAGE: Record<string, BuildingCategory> = {
  事務所建築物: 'office',
  商業施設: 'commercial',
  宿泊施設: 'hotel',
  集合住宅: 'apartment',
  独立住宅: 'house',
  住商併用建物: 'mixed_house',
  教育施設: 'education_welfare',
  医療施設: 'education_welfare',
  厚生施設: 'education_welfare',
  文化施設: 'public',
  官公庁施設: 'public',
  運輸施設等: 'warehouse',
  倉庫施設等: 'warehouse',
  専用工場: 'factory',
  住居併用工場: 'mixed_house',
  供給施設: 'utility',
  処理施設: 'utility',
  遊興施設: 'commercial',
  興行施設: 'commercial',
};

/** uro:buildingStructureType（BuildingDetailAttribute_buildingStructureType.xml） */
export const STRUCTURE_TYPE: Record<string, StructureType> = {
  '601': 'wood',
  '602': 'src',
  '603': 'rc',
  '604': 'steel',
  '605': 'light_steel',
  '606': 'masonry',
  木造・土蔵造: 'wood',
  鉄骨鉄筋コンクリート造: 'src',
  鉄筋コンクリート造: 'rc',
  鉄骨造: 'steel',
  軽量鉄骨造: 'light_steel',
  'レンガ造・コンクリートブロック造・石造': 'masonry',
};

/** 耐火性能の区分。uro:fireproofStructureType と、東京都の「建物構造コード」（KeyValuePair）の両方の表記を扱う */
export function toFireResistance(label: unknown): FireResistance {
  if (typeof label !== 'string') return 'unknown';
  if (label.startsWith('準耐火')) return 'quasi_fireproof';
  if (label.startsWith('耐火')) return 'fireproof';
  if (label.includes('防火')) return 'fire_protected';
  if (label === '木造' || label === 'その他') return 'other';
  return 'unknown';
}
