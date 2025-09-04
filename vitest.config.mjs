// @ts-check
import typegpu from 'unplugin-typegpu/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [typegpu({ include: /.*/ })],
        test: {
          name: 'node',
          environment: 'jsdom',
          setupFiles: ['packages/byegl/tests/setup.ts'],
          include: ['**/*.test.ts'],
          exclude: ['**/*.test.browser.ts', '**/node_modules'],
        },
      },
      {
        plugins: [typegpu({ include: /.*/ })],
        test: {
          name: 'browser',
          browser: {
            enabled: true,
            provider: 'webdriverio',
            headless: false,
            instances: [{ browser: 'chrome' }],
          },
          include: ['**/*.test.browser.ts'],
          exclude: ['**/*.test.ts', '**/node_modules'],
        },
      },
    ],
  },
});
