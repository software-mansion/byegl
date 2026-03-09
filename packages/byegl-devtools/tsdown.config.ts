import { defineConfig } from 'tsdown';
import typegpu from 'unplugin-typegpu/rolldown';

export default defineConfig({
  entry: { 'injected/force-byegl': 'src/force-byegl.ts' },
  plugins: [typegpu({})],
  platform: 'browser',
  target: 'chrome113',
  format: 'iife',
  sourcemap: false,
  // Bundle all dependencies (including byegl) into a single file so the
  // injected script has no network dependencies and runs synchronously.
  deps: {
    alwaysBundle: /./,
  },
  outDir: './dist',
});
