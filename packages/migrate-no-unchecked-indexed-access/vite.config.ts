import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    clean: true,
    deps: {
      neverBundle: ['typescript'],
    },
    entry: ['src/cli.ts'],
    format: ['esm'],
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    target: 'node22',
    treeshake: true,
  },
})
