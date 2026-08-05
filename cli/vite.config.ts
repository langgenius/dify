import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { resolveBuildInfo } from './scripts/lib/resolve-buildinfo.js'

const buildInfo = resolveBuildInfo()

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  pack: {
    entry: ['src/index.ts', 'src/commands/**/*.ts', 'src/framework/**/*.ts'],
    format: ['esm'],
    fixedExtension: false,
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: false,
    outDir: 'dist',
    target: 'node22',
    define: {
      __DIFYCTL_VERSION__: JSON.stringify(buildInfo.version),
      __DIFYCTL_COMMIT__: JSON.stringify(buildInfo.commit),
      __DIFYCTL_BUILD_DATE__: JSON.stringify(buildInfo.buildDate),
      __DIFYCTL_CHANNEL__: JSON.stringify(buildInfo.channel),
      __DIFYCTL_MIN_DIFY__: JSON.stringify(buildInfo.minDify),
      __DIFYCTL_MAX_DIFY__: JSON.stringify(buildInfo.maxDify),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.ts', 'src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**'],
    },
  },
})
