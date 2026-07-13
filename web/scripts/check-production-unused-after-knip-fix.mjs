import { spawn } from 'node:child_process'
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const webDir = path.join(repoRoot, 'web')
const unusedLintConfig = path.join(webDir, 'oxlint.unused.config.json')
const require = createRequire(import.meta.url)
const vitePlusEntry = realpathSync(require.resolve('vite-plus'))
const vitePlusRequire = createRequire(vitePlusEntry)
// Resolve the bundled binary directly so Vite+ cannot inject unrelated project lint rules.
const oxlintPackagePath = vitePlusRequire.resolve('oxlint/package.json')
const oxlintManifest = vitePlusRequire(oxlintPackagePath)
const oxlintBin =
  typeof oxlintManifest.bin === 'string' ? oxlintManifest.bin : oxlintManifest.bin?.oxlint
if (!oxlintBin) throw new Error('Unable to resolve the bundled Oxlint executable.')
const oxlint = path.resolve(path.dirname(oxlintPackagePath), oxlintBin)

function commandName(name) {
  return process.platform === 'win32' ? `${name}.cmd` : name
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: process.env,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data) => (stdout += data))
    child.stderr.on('data', (data) => (stderr += data))
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

function parseOxlintJson(stdout) {
  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) throw new Error('Oxlint produced no JSON output.')

  return JSON.parse(stdout.slice(jsonStart))
}

function relativeDiagnostic(diagnostic) {
  const label = diagnostic.labels?.[0]
  const diagnosticFile = label?.file ?? diagnostic.filename
  const filePath = diagnosticFile
    ? path.relative(
        webDir,
        path.isAbsolute(diagnosticFile) ? diagnosticFile : path.join(webDir, diagnosticFile),
      )
    : '<unknown>'
  const span = label?.span ? `:${label.span.line}:${label.span.column}` : ''

  return `${filePath}${span} ${diagnostic.code ?? ''} ${diagnostic.message ?? ''}`.trim()
}

async function ensureCleanWorktree() {
  const result = await run('git', ['status', '--porcelain=v1'], { cwd: repoRoot })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    throw new Error('Failed to check git status.')
  }

  if (!result.stdout.trim()) return

  console.error('This check runs knip --fix and must start from a clean worktree.')
  console.error('Commit or stash your changes first, then run it again.')
  console.error(result.stdout)
  process.exit(1)
}

async function restoreWorktree() {
  const restoreResult = await run('git', ['restore', '--staged', '--worktree', '.'], {
    cwd: repoRoot,
  })
  if (restoreResult.status !== 0) {
    process.stdout.write(restoreResult.stdout)
    process.stderr.write(restoreResult.stderr)
    throw new Error('Failed to restore tracked files after knip --fix.')
  }

  const cleanResult = await run('git', ['clean', '-fd', '--', 'web'], {
    cwd: repoRoot,
  })
  if (cleanResult.status !== 0) {
    process.stdout.write(cleanResult.stdout)
    process.stderr.write(cleanResult.stderr)
    throw new Error('Failed to clean untracked files after knip --fix.')
  }
}

const knip = path.join(webDir, 'node_modules', '.bin', commandName('knip'))
let shouldRestore = false
let hasUnusedMessages = false

try {
  await ensureCleanWorktree()
  shouldRestore = true

  console.log('Running knip --production --fix...')
  const knipResult = await run(knip, ['--production', '--fix'], { cwd: webDir })
  if (knipResult.status !== 0) {
    process.stdout.write(knipResult.stdout)
    process.stderr.write(knipResult.stderr)
    throw new Error('knip --production --fix failed.')
  }

  console.log('Running isolated Oxlint unused checks after knip --fix...')
  const lintResult = await run(
    process.execPath,
    [oxlint, '--config', unusedLintConfig, '--format', 'json', '.'],
    { cwd: webDir },
  )

  let lintOutput
  try {
    lintOutput = parseOxlintJson(lintResult.stdout)
  } catch {
    process.stdout.write(lintResult.stdout)
    process.stderr.write(lintResult.stderr)
    throw new Error('Failed to parse Oxlint JSON output.')
  }

  const unusedMessages = (lintOutput.diagnostics ?? []).map(relativeDiagnostic)
  if (lintResult.status !== 0 && unusedMessages.length === 0) {
    process.stdout.write(lintResult.stdout)
    process.stderr.write(lintResult.stderr)
    throw new Error(`Oxlint unused check failed with exit code ${lintResult.status}.`)
  }

  if (unusedMessages.length > 0) {
    hasUnusedMessages = true
    console.error('Unused declarations remain after applying knip --production --fix.')
    console.error(
      'Remove these declarations; if they are only referenced by tests, remove the matching tests too.',
    )
    for (const message of unusedMessages) console.error(message)
  } else {
    console.log('No Oxlint unused declarations remain after knip --production --fix.')
  }
} finally {
  if (shouldRestore) {
    console.log('Restoring checkout after knip --fix...')
    await restoreWorktree()
  }
}

if (hasUnusedMessages) process.exit(1)
