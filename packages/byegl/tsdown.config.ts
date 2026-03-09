import { defineConfig } from 'tsdown';
import typegpu from 'unplugin-typegpu/rolldown';

export default defineConfig({
  plugins: [typegpu({})],
  platform: 'neutral',
  target: false,
  sourcemap: false,
});
