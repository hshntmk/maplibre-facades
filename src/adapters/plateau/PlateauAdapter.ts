import type { BuildingCategory, BuildingRecord, FootprintGeometry, StructureType } from '../../model/BuildingRecord';
import { pick, toNumber, type AdapterContext, type BuildingAdapter } from '../BuildingAdapter';
import { KEYS, MISSING_VALUES } from './attributeKeys';
import { DETAILED_USAGE, STRUCTURE_TYPE, USAGE, USAGE_BY_LABEL, toFireResistance } from './codelists';

const missing = MISSING_VALUES as unknown as (number | string)[];

function resolveCategory(props: Record<string, unknown>): { category: BuildingCategory; estimated: boolean } {
  const code = pick(props, KEYS.usageCode);
  const label = pick(props, KEYS.usage);
  let category: BuildingCategory | undefined =
    (code !== undefined ? USAGE[String(code)]?.category : undefined) ??
    (label !== undefined ? (USAGE[String(label)]?.category ?? USAGE_BY_LABEL[String(label)]) : undefined);

  // 「その他」「不明」は詳細用途で補正する
  if (category === undefined || category === 'unknown' || category === 'other') {
    const detailed = pick(props, KEYS.detailedUsage);
    const refined = detailed !== undefined ? DETAILED_USAGE[String(detailed)] : undefined;
    if (refined) return { category: refined, estimated: false };
  }
  return { category: category ?? 'unknown', estimated: false };
}

function resolveStructure(props: Record<string, unknown>): StructureType {
  const v = pick(props, KEYS.structureType);
  if (v !== undefined) return STRUCTURE_TYPE[String(v)] ?? 'unknown';
  // 東京都データは構造種別がなく、「建物構造コード」に木造が入る場合がある
  if (pick(props, KEYS.tokyoStructureCode) === '木造') return 'wood';
  return 'unknown';
}

type Obj = Record<string, unknown>;
const first = (v: unknown): Obj | undefined => (Array.isArray(v) ? (v[0] as Obj) : v && typeof v === 'object' ? (v as Obj) : undefined);

/**
 * PLATEAU の 3D Tiles はバッチテーブルの attributes に CityGML の属性をネストして持つ。
 * コード値や詳細用途などはそこにしかないので、フラットな属性名（attributeKeys.ts の候補）として補う。
 */
export function withNestedPlateauAttributes(props: Obj): Obj {
  const a = typeof props.attributes === 'string' ? safeParse(props.attributes) : props.attributes;
  if (!a || typeof a !== 'object') return props;
  const attrs = a as Obj;
  const out: Obj = { ...props };
  const set = (k: string, v: unknown) => {
    if (out[k] === undefined && v !== undefined && v !== null) out[k] = v;
  };
  for (const k of ['gml:id', 'gml:name', 'bldg:usage', 'bldg:usage_code', 'bldg:class', 'bldg:class_code', 'bldg:measuredHeight', 'bldg:storeysAboveGround', 'bldg:storeysBelowGround', 'bldg:yearOfConstruction']) {
    set(k, attrs[k]);
  }
  const detail = first(attrs['uro:BuildingDetailAttribute'] ?? attrs['uro:BuildingDetails']);
  if (detail) {
    for (const k of ['uro:detailedUsage', 'uro:detailedUsage_code', 'uro:buildingStructureType', 'uro:buildingStructureType_code', 'uro:fireproofStructureType', 'uro:fireproofStructureType_code']) {
      set(`uro:BuildingDetailAttribute_${k}`, detail[k]);
    }
  }
  const kvs = attrs['uro:KeyValuePairAttribute'];
  if (Array.isArray(kvs)) {
    for (const kv of kvs as Obj[]) if (kv['uro:key'] === '建物構造コード') set('uro:KeyValuePairAttribute_建物構造コード', kv['uro:codeValue']);
  }
  return out;
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function createPlateauAdapter(): BuildingAdapter {
  return {
    name: 'plateau',
    toRecord(rawProps, geometry: FootprintGeometry, ctx: AdapterContext): BuildingRecord | null {
      const props = withNestedPlateauAttributes(rawProps);
      const id = pick(props, KEYS.id);
      if (id === undefined) return null;

      const measured = toNumber(pick(props, KEYS.measuredHeight), missing);
      const zmin = toNumber(pick(props, KEYS.zmin), missing);
      const zmax = toNumber(pick(props, KEYS.zmax), missing);
      const lod1Height = zmin !== undefined && zmax !== undefined && zmax > zmin ? zmax - zmin : undefined;
      const height = measured ?? lod1Height;

      const storeys = toNumber(pick(props, KEYS.storeysAbove), missing);
      const storeysBelow = toNumber(pick(props, KEYS.storeysBelow), missing);
      const { category, estimated } = resolveCategory(props);
      const buildingClass = pick(props, KEYS.buildingClass);
      const name = pick(props, KEYS.name);

      return {
        id: String(id),
        geometry,
        height: height ?? 0,
        minHeight: 0,
        storeys: storeys !== undefined && storeys > 0 ? storeys : undefined,
        storeysBelow,
        category,
        structure: resolveStructure(props),
        fireResistance: toFireResistance(pick(props, KEYS.fireproof) ?? pick(props, KEYS.tokyoStructureCode)),
        openSided: typeof buildingClass === 'string' && buildingClass.includes('無壁舎'),
        name: typeof name === 'string' ? name : undefined,
        yearBuilt: toNumber(pick(props, KEYS.yearBuilt), missing),
        floorArea: undefined,
        provenance: {
          source: ctx.sourceId,
          heightEstimated: measured === undefined,
          storeysEstimated: storeys === undefined,
          categoryEstimated: estimated,
        },
        extras: {
          usage: String(pick(props, KEYS.usage) ?? ''),
          detailedUsage: String(pick(props, KEYS.detailedUsage) ?? ''),
          buildingClass: String(buildingClass ?? ''),
        },
      };
    },
  };
}
