import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import tailwindcss from '@tailwindcss/vite'
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
    include: ['vite-plus/test/browser'],
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
      screenshotDirectory: './.vitest-browser/screenshots',
      screenshotFailures: true,
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
    projects: [
      {
        extends: true,
        plugins: [tailwindcss()],
        test: {
          name: 'unit',
          globals: true,
          setupFiles: ['./vitest.setup.ts'],
          include: ['src/**/__tests__/**/*.spec.{ts,tsx}'],
          browser: {
            trace: {
              mode: 'retain-on-failure',
              tracesDir: './.vitest-browser/traces',
            },
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
        },
      },
    ],
  },
})
