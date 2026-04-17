import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'

const isCI = !!process.env.CI

export default defineConfig({
  plugins: [react()],
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
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
