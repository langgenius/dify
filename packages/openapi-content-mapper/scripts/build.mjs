import { spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
// Remove obsolete exports before packaging so deleted APIs cannot survive in dist.
rmSync(resolve(root, 'dist'), { recursive: true, force: true })
const result = spawnSync(
  process.execPath,
  [resolve(require.resolve('typescript/package.json'), '../bin/tsc'), '-p', root],
  {
    cwd: root,
    stdio: 'inherit',
  },
)
if (result.error) throw result.error
process.exitCode = result.status ?? 1
