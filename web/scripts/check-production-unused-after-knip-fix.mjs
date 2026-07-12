import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(scriptDir, '../..')
const webDir = path.join(repoRoot, 'web')

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

function parseVpLintJson(stdout) {
  const jsonStart = stdout.indexOf('{')
  if (jsonStart === -1) return { diagnostics: [] }

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

  const cleanResult = await run('git', ['clean', '-fd', '--', 'web', '.eslintcache'], {
    cwd: repoRoot,
  })
  if (cleanResult.status !== 0) {
    process.stdout.write(cleanResult.stdout)
    process.stderr.write(cleanResult.stderr)
    throw new Error('Failed to clean untracked files after knip --fix.')
  }
}

const knip = path.join(webDir, 'node_modules', '.bin', commandName('knip'))
const vp = path.join(repoRoot, 'node_modules', '.bin', commandName('vp'))
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

  console.log('Running Vite+ unused checks after knip --fix...')
  const lintResult = await run(
    vp,
    [
      'lint',
      '-A',
      'all',
      '-D',
      'no-unused-vars',
      '--format',
      'json',
      '--ignore-pattern',
      'public/**',
      '--ignore-pattern',
      'coverage/**',
      '--ignore-pattern',
      '.next/**',
      '--ignore-pattern',
      '**/__tests__/**',
      '--ignore-pattern',
      '**/*.spec.ts',
      '--ignore-pattern',
      '**/*.spec.tsx',
      '--ignore-pattern',
      '**/*.test.ts',
      '--ignore-pattern',
      '**/*.test.tsx',
      '.',
    ],
    { cwd: webDir },
  )

  let lintOutput
  try {
    lintOutput = parseVpLintJson(lintResult.stdout)
  } catch {
    process.stdout.write(lintResult.stdout)
    process.stderr.write(lintResult.stderr)
    throw new Error('Failed to parse Vite+ lint JSON output.')
  }

  const unusedMessages = (lintOutput.diagnostics ?? []).map(relativeDiagnostic)

  if (unusedMessages.length > 0) {
    hasUnusedMessages = true
    console.error('Unused declarations remain after applying knip --production --fix.')
    console.error(
      'Remove these declarations; if they are only referenced by tests, remove the matching tests too.',
    )
    for (const message of unusedMessages) console.error(message)
  } else {
    console.log('No Vite+ unused declarations remain after knip --production --fix.')
  }
} finally {
  if (shouldRestore) {
    console.log('Restoring checkout after knip --fix...')
    await restoreWorktree()
  }
}

if (hasUnusedMessages) process.exit(1)
