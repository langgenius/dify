import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const isCI = !!process.env.CI
const isStorybookTest = process.env.VITEST_STORYBOOK === 'true'

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
  test: isStorybookTest
    ? {
        projects: [
          {
            extends: true,
            plugins: [
              storybookTest({
                configDir: path.join(dirname, '.storybook'),
                storybookScript: 'pnpm storybook --no-open',
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
      }
    : {
        globals: true,
        setupFiles: ['./vitest.setup.ts'],
        browser: {
          enabled: true,
          provider: playwright(),
          instances: [{ browser: 'chromium' }],
          headless: true,
        },
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
      },
})
