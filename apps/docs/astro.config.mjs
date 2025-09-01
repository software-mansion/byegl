// @ts-check

import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import typegpu from 'unplugin-typegpu/vite';
import mkcert from 'vite-plugin-mkcert';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  base: '/byegl',

  vite: {
    plugins: [tailwindcss(), typegpu({}), mkcert()],
  },

  integrations: [mdx()],
});