import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  external: ['react', 'react-dom', 'lucide-react'],
  treeshake: true,
  splitting: false,
  minify: false,
  sourcemap: true,
  target: 'es2020',
  // Ship the worklet + WAV/Opus worker files in dist/workers so hosts under a
  // strict CSP can bundle them locally (see copy-runtime-assets.mjs).
  onSuccess: 'node scripts/copy-runtime-assets.mjs',
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.js' : '.mjs',
    }
  },
});