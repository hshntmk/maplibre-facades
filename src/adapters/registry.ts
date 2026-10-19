import { BuildingFacadeLayerError } from '../errors';
import type { AdapterConfig, AdapterFactory, BuildingAdapter } from './BuildingAdapter';
import { createDeclarativeAdapter } from './DeclarativeAdapter';
import { createPlateauAdapter } from './plateau/PlateauAdapter';

// 組み込みアダプタ。OSM / Overture などはここに追加する。
// このレジストリは Worker 内にあるため、メインスレッドから関数を登録することはできない。
// 利用者独自のソースは宣言的アダプタ（JSON）で扱う。
const factories: Record<string, AdapterFactory> = {
  plateau: () => createPlateauAdapter(),
};

export function registerAdapter(name: string, factory: AdapterFactory): void {
  factories[name] = factory;
}

export function createAdapter(config: AdapterConfig): BuildingAdapter {
  if ('spec' in config && config.name === 'declarative') return createDeclarativeAdapter(config.spec);
  const factory = factories[config.name];
  if (!factory) throw new BuildingFacadeLayerError('adapter', `Unknown building adapter: ${config.name}`);
  return factory('options' in config ? config.options : undefined);
}
