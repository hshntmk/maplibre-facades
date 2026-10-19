import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// GeoJSON 版のデータ（npm run prepare-data で作る。リポジトリには含めない）があるときだけ、デモで選べるようにする
const geojsonPath = fileURLToPath(new URL('./public/data/13101_bldg_lod1.geojson', import.meta.url));

// 例はパッケージ名で import し、開発中はソースを直接参照する
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // GitHub Pages（https://<user>.github.io/<repo>/）のようにサブパスに置いても動くよう、相対パスで出力する
  base: './',
  define: { __DEMO_GEOJSON__: JSON.stringify(existsSync(geojsonPath)) },
  resolve: {
    alias: {
      'maplibre-facades': fileURLToPath(new URL('../../src/index.ts', import.meta.url)),
      // draco3d の Node 用コードが参照するモジュール（ブラウザでは使われない）
      fs: fileURLToPath(new URL('../../src/shims/empty.ts', import.meta.url)),
      path: fileURLToPath(new URL('../../src/shims/empty.ts', import.meta.url)),
    },
  },
  // maplibre-gl v6 は自身の Web Worker を import.meta.url 基準で読み込むため、事前バンドルから外す
  optimizeDeps: { exclude: ['maplibre-gl'] },
  worker: { format: 'es' },
  server: { port: Number(process.env.PORT) || 5180 },
});
