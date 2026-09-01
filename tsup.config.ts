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
  // Ship the ffmpeg-wasm core in dist/ffmpeg so hosts under a strict CSP can
  // bundle it locally instead of loading from a CDN (see copy-ffmpeg-core.mjs).
  onSuccess: 'node scripts/copy-ffmpeg-core.mjs',
  outExtension({ format }) {
    return {
      js: format === 'cjs' ? '.js' : '.mjs',
    }
  },
});