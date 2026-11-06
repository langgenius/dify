import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, lazyPlugins } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const configDir = path.join(dirname, '.storybook')
const isCI = !!process.env.CI

export default defineConfig({
  plugins: lazyPlugins(async () => {
    const { default: react } = await import('@vitejs/plugin-react')
    return [react()]
  }),
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
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
        plugins: lazyPlugins(async () => {
          const { default: tailwindcss } = await import('@tailwindcss/vite')
          return [tailwindcss()]
        }),
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
        plugins: lazyPlugins(async () => {
          const { storybookTest } = await import('@storybook/addon-vitest/vitest-plugin')
          return [storybookTest({ configDir })]
        }),
        test: {
          name: 'storybook',
        },
      },
    ],
  },
})
