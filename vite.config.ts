import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// ライブラリ本体（dist/index.js）。ワーカーは ?worker&inline でこの中に埋め込まれる。
// maplibre-gl は型のみ参照し、実行時には import しない。
// draco3d の Node 用コードが参照する fs / path を空のモジュールにする（ブラウザでは使われない）
const nodeShims = { fs: fileURLToPath(new URL('src/shims/empty.ts', import.meta.url)), path: fileURLToPath(new URL('src/shims/empty.ts', import.meta.url)) };

export default defineConfig({
  resolve: { alias: nodeShims },
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: () => 'index.js' },
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rolldownOptions: { external: ['maplibre-gl', /^@maplibre\//] },
  },
  worker: { format: 'es' },
  plugins: [
    {
      // 埋め込みワーカーのソースマップ（assets/*.map）は参照先がないので出力しない
      name: 'drop-inline-worker-sourcemaps',
      generateBundle(_options, bundle) {
        for (const file of Object.keys(bundle)) if (file.startsWith('assets/') && file.endsWith('.map')) delete bundle[file];
      },
    },
  ],
  test: { include: ['tests/**/*.test.ts'] },
});
