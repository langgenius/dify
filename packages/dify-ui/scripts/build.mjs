import { cp, mkdir, rm } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distDir = resolve(packageRoot, 'dist')

await rm(distDir, { recursive: true, force: true })

const tsc = spawnSync('pnpm', ['exec', 'tsc', '-p', 'tsconfig.build.json'], {
  cwd: packageRoot,
  stdio: 'inherit',
})

if (tsc.status !== 0)
  process.exit(tsc.status ?? 1)

await mkdir(distDir, { recursive: true })

await cp(resolve(packageRoot, 'src/styles.css'), resolve(packageRoot, 'dist/styles.css'))
await cp(resolve(packageRoot, 'src/markdown.css'), resolve(packageRoot, 'dist/markdown.css'))
await cp(resolve(packageRoot, 'src/styles'), resolve(packageRoot, 'dist/styles'), {
  force: true,
  recursive: true,
})

await cp(resolve(packageRoot, 'src/themes'), resolve(packageRoot, 'dist/themes'), {
  force: true,
  recursive: true,
})
