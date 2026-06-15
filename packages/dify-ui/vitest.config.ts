import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const configDir = path.join(dirname, '.storybook')
const isCI = !!process.env.CI

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: [
      '@base-ui/react/form',
      '@base-ui/react/merge-props',
      '@base-ui/react/use-render',
    ],
  },
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.stories.{ts,tsx}',
        'src/**/__tests__/**',
        'src/themes/**',
        'src/styles/**',
      ],
      reporter: isCI ? ['json', 'json-summary'] : ['text', 'json', 'json-summary'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/__tests__/**/*.spec.{ts,tsx}'],
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            headless: true,
          },
        },
      },
      {
        extends: true,
        plugins: [
          storybookTest({
            configDir,
          }),
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            provider: playwright(),
            instances: [{ browser: 'chromium' }],
            headless: true,
          },
        },
      },
    ],
  },
})
