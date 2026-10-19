import { featureFilter, type ExpressionFilterSpecification } from '@maplibre/maplibre-gl-style-spec';
import { BuildingFacadeLayerError } from '../errors';
import { recordToExpressionProperties, type BuildingRecord } from '../model/BuildingRecord';

/** MapLibre の式で書くスタイル選択ルール。式は共通モデルの属性（category, storeys…）を参照する */
export interface StyleRule {
  when: ExpressionFilterSpecification | true;
  style: string;
}

export class StyleResolver {
  private readonly compiled: { test: (props: Record<string, unknown>) => boolean; styleIndex: number }[];

  constructor(rules: StyleRule[], styleNames: string[]) {
    this.compiled = rules.map((rule, i) => {
      const styleIndex = styleNames.indexOf(rule.style);
      if (styleIndex < 0) throw new BuildingFacadeLayerError('style', `styleRules[${i}]: unknown style "${rule.style}"`);
      if (rule.when === true) return { test: () => true, styleIndex };
      let filter: ReturnType<typeof featureFilter>['filter'];
      try {
        ({ filter } = featureFilter(rule.when, `styleRules[${i}].when`));
      } catch (e) {
        throw new BuildingFacadeLayerError('style', `styleRules[${i}].when: ${e instanceof Error ? e.message : e}`, { cause: e });
      }
      return {
        test: (properties: Record<string, unknown>) => filter({ zoom: 0 }, { type: 3, properties }),
        styleIndex,
      };
    });
  }

  /** マッチしたスタイルの番号。どれにも当たらなければ -1 */
  resolve(record: BuildingRecord): number {
    const props = recordToExpressionProperties(record);
    for (const c of this.compiled) if (c.test(props)) return c.styleIndex;
    return -1;
  }
}
