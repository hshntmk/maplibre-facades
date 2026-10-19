// PLATEAU の属性名は、配信形式（3D Tiles / MVT / GeoJSON 変換結果）や製品仕様の年度によって異なる。
// 候補キーを優先順に並べて、最初に見つかったものを使う。

export const KEYS = {
  id: ['gml_id', 'gml:id', 'id'],
  name: ['gml:name', 'name'],
  usage: ['bldg:usage', 'usage', '用途'],
  usageCode: ['bldg:usage_code', 'usage_code'],
  detailedUsage: ['uro:BuildingDetailAttribute_uro:detailedUsage', 'uro:detailedUsage', '詳細用途'],
  measuredHeight: ['bldg:measuredHeight', 'measuredHeight', '計測高さ'],
  storeysAbove: ['bldg:storeysAboveGround', 'storeysAboveGround', '地上階数'],
  storeysBelow: ['bldg:storeysBelowGround', 'storeysBelowGround', '地下階数'],
  structureType: [
    'uro:BuildingDetailAttribute_uro:buildingStructureType',
    'uro:BuildingDetails_uro:buildingStructureType',
    'uro:buildingStructureType',
    '構造種別',
  ],
  fireproof: [
    'uro:BuildingDetailAttribute_uro:fireproofStructureType',
    'uro:BuildingDetails_uro:fireproofStructureType',
    'uro:fireproofStructureType',
    '耐火構造種別',
  ],
  tokyoStructureCode: ['uro:KeyValuePairAttribute_建物構造コード', '建物構造コード'],
  buildingClass: ['bldg:class', 'class'],
  roofEdgeArea: ['uro:BuildingDetailAttribute_uro:buildingRoofEdgeArea', 'uro:buildingRoofEdgeArea'],
  yearBuilt: ['bldg:yearOfConstruction', 'uro:BuildingDetailAttribute_uro:yearOfConstruction', '建築年'],
  zmin: ['_zmin'],
  zmax: ['_zmax'],
} as const;

/** 欠損を表す値 */
export const MISSING_VALUES = [-9999, 9999, '-9999', '9999'] as const;
