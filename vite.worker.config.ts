import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 単体で配置するワーカー（dist/worker.js）。CSP で blob: の Worker が使えない環境向け。
// 依存はすべてバンドルし、import を持たない 1 ファイルにする。
// draco3d の Node 用コードが参照する fs / path を空のモジュールにする（ブラウザでは使われない）
const nodeShims = { fs: fileURLToPath(new URL('src/shims/empty.ts', import.meta.url)), path: fileURLToPath(new URL('src/shims/empty.ts', import.meta.url)) };

export default defineConfig({
  resolve: { alias: nodeShims },
  build: {
    lib: { entry: 'src/worker/buildingWorker.ts', formats: ['es'], fileName: () => 'worker.js' },
    outDir: 'dist',
    emptyOutDir: false,
    sourcemap: true,
    target: 'es2022',
    minify: true,
  },
});
