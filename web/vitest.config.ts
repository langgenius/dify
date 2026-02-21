import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const isCI = !!process.env.CI

export default mergeConfig(viteConfig, defineConfig({
  plugins: [
    {
      // Stub .mdx files so components importing them can be unit-tested
      name: 'mdx-stub',
      enforce: 'pre',
      transform(_, id) {
        if (id.endsWith('.mdx'))
          return { code: 'export default () => null', map: null }
      },
    },
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
    },
  },
}))
