// 既定ではワーカーをバンドル内に埋め込み（Blob URL）、利用側のバンドラ設定に依存せず動くようにする。
// CSP で blob: の Worker が禁止されている環境では、配布物の `dist/worker.js` を配置して URL を指定する。
import InlineBuildingWorker from './buildingWorker?worker&inline';

let globalWorkerUrl: string | URL | undefined;

/** すべての BuildingWindowLayer が使うワーカーの URL を設定する（`maplibre-facades/worker` を配置した場所） */
export function setWorkerUrl(url: string | URL | undefined): void {
  globalWorkerUrl = url;
}

export function getWorkerUrl(): string | URL | undefined {
  return globalWorkerUrl;
}

export function createBuildingWorker(url?: string | URL): Worker {
  const resolved = url ?? globalWorkerUrl;
  return resolved ? new Worker(resolved, { type: 'module', name: 'maplibre-facades' }) : new InlineBuildingWorker({ name: 'maplibre-facades' });
}
