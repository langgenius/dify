import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    clean: true,
    deps: {
      neverBundle: [
        '@hono/node-server',
        'c12',
        'hono',
      ],
    },
    entry: [
      'src/index.ts',
      'src/cli.ts',
    ],
    format: ['esm'],
    outDir: 'dist',
    platform: 'node',
    sourcemap: true,
    target: 'node22',
    treeshake: true,
  },
  test: {
    environment: 'node',
  },
})
