// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import typegpu from 'unplugin-typegpu/vite';

// https://astro.build/config
export default defineConfig({
  base: '/byegl',
  vite: {
    plugins: [tailwindcss(), typegpu({})],
  },
});
