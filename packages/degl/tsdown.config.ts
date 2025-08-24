import { defineConfig } from 'tsdown';
import typegpu from 'unplugin-typegpu/rolldown';

export default defineConfig({
  entry: ['./src/webgl/index.ts', './src/webgl2/index.ts'],
  dts: true,
  plugins: [typegpu({})],
});
