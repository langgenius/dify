import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const PRESERVED_FILES = new Set([
  'web/package.json',
  'web/tsconfig.json',
  'web/scripts/migrate-no-unchecked-indexed-access.ts',
  'web/scripts/run-no-unchecked-indexed-access-migration.ts',
  'web/scripts/normalize-no-unchecked-indexed-access-migration.ts',
  'web/scripts/reset-no-unchecked-indexed-access-migration.ts',
])

async function getTrackedChangedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['diff', '--name-only', 'HEAD', '--', 'web'], {
    cwd: path.resolve(process.cwd(), '..'),
    maxBuffer: 1024 * 1024 * 8,
  })

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function getUntrackedFiles(): Promise<string[]> {
  const { stdout } = await execFileAsync('git', ['ls-files', '--others', '--exclude-standard', '--', 'web'], {
    cwd: path.resolve(process.cwd(), '..'),
    maxBuffer: 1024 * 1024 * 8,
  })

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

async function main() {
  const repoRoot = path.resolve(process.cwd(), '..')
  const trackedChangedFiles = await getTrackedChangedFiles()
  const untrackedFiles = await getUntrackedFiles()

  let restoredCount = 0
  for (const relativePath of trackedChangedFiles) {
    if (PRESERVED_FILES.has(relativePath))
      continue

    const { stdout } = await execFileAsync('git', ['show', `HEAD:${relativePath}`], {
      cwd: repoRoot,
      maxBuffer: 1024 * 1024 * 16,
    })
    const absolutePath = path.resolve(repoRoot, relativePath)
    await fs.mkdir(path.dirname(absolutePath), { recursive: true })
    await fs.writeFile(absolutePath, stdout)
    restoredCount += 1
  }

  let removedCount = 0
  for (const relativePath of untrackedFiles) {
    if (PRESERVED_FILES.has(relativePath))
      continue

    await fs.rm(path.resolve(repoRoot, relativePath), { force: true })
    removedCount += 1
  }

  console.log(`Restored ${restoredCount} tracked file(s) and removed ${removedCount} untracked file(s).`)
}

await main()
