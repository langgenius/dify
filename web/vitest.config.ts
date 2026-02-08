import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config'

const isCI = !!process.env.CI

export default mergeConfig(viteConfig, defineConfig({
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
