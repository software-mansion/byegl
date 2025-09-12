// @ts-check

import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'astro/config';
import typegpu from 'unplugin-typegpu/vite';

// https://astro.build/config
export default defineConfig({
  base: '/byegl',

  vite: {
    plugins: [
      tailwindcss(),
      typegpu({}),
      {
        ...basicSsl(),
        apply: (_, { mode }) => mode === 'https',
      },
    ],
  },

  integrations: [mdx()],
});
