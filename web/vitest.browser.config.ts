import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite-plus'
import { playwright } from 'vite-plus/test/browser-playwright'

export default defineConfig({
  define: {
    'process.env': '{}',
  },
  plugins: [tailwindcss(), react()],
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    include: ['vite-plus/test/browser'],
  },
  test: {
    globals: true,
    setupFiles: ['./vitest.browser.setup.ts'],
    include: ['app/**/*.browser.spec.{ts,tsx}'],
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
})
