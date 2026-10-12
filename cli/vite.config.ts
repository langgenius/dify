import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import { resolveBuildInfo } from './scripts/lib/resolve-buildinfo.js'

const buildInfo = resolveBuildInfo({
  env: { ...process.env, DIFYCTL_CHANNEL: process.env.DIFYCTL_CHANNEL ?? 'dev' },
})

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@test': fileURLToPath(new URL('./test', import.meta.url)),
    },
  },
  pack: {
    deps: { resolveDepSubpath: true },
    entry: ['src/main.ts', 'src/kernel/**/*.ts', 'src/plugins/**/*.ts', 'src/commands/**/*.ts'],
    format: ['esm'],
    fixedExtension: false,
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: false,
    outDir: 'dist',
    target: 'node24',
    define: {
      __DIFYCTL_VERSION__: JSON.stringify(buildInfo.version),
      __DIFYCTL_COMMIT__: JSON.stringify(buildInfo.commit),
      __DIFYCTL_BUILD_DATE__: JSON.stringify(buildInfo.buildDate),
      __DIFYCTL_CHANNEL__: JSON.stringify(buildInfo.channel),
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
      exclude: ['src/**/*.test.ts'],
    },
  },
})
