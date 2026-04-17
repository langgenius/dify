import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'

const isCI = !!process.env.CI

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
      api: {
        host: '127.0.0.1',
        port: 63315,
        strictPort: true,
      },
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
