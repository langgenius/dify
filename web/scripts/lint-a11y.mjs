import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'

const webRoot = path.resolve(import.meta.dirname, '..')
const repositoryRoot = path.resolve(webRoot, '..')
const configPath = path.resolve(import.meta.dirname, 'a11y', 'oxlint.config.ts')
const require = createRequire(import.meta.url)
const vitePlusRequire = createRequire(require.resolve('vite-plus/package.json'))
const oxlintPackageDirectory = path.dirname(vitePlusRequire.resolve('oxlint/package.json'))
const oxlintEntry = path.resolve(oxlintPackageDirectory, 'bin', 'oxlint')
const inputTargets = process.argv.slice(2)

if (inputTargets.length === 0) {
  console.error('Usage: pnpm lint:a11y <page-file-or-directory> [...]')
  process.exit(2)
}

const targets = inputTargets.map((target) => {
  if (path.isAbsolute(target)) return target

  if (target === 'web' || target.startsWith('web/') || target.startsWith('web\\'))
    return path.resolve(repositoryRoot, target)

  return path.resolve(webRoot, target)
})

const result = spawnSync(process.execPath, [oxlintEntry, '-c', configPath, ...targets], {
  cwd: webRoot,
  stdio: 'inherit',
})

if (result.error) {
  console.error(`Failed to start the accessibility lint: ${result.error.message}`)
  process.exit(1)
}

process.exit(result.status ?? 1)
