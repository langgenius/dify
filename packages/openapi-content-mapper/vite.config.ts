import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    clean: true,
    deps: { neverBundle: true },
    // Vite+ 1.4's declaration generator does not detect TypeScript 7.1 beta.
    dts: false,
    entry: ['src/**/*.ts'],
    format: ['esm'],
    onSuccess: 'tsc -p tsconfig.json --emitDeclarationOnly',
    outDir: 'dist',
    fixedExtension: false,
    platform: 'node',
    root: 'src',
    target: 'node24',
    // The mapper hashes its sibling modules to invalidate cached compiler output.
    unbundle: true,
  },
})
