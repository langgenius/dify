import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const UNUSED_RULES = new Set([
  'unused-imports/no-unused-vars',
  'unused-imports/no-unused-imports',
  '@typescript-eslint/no-unused-vars',
  'no-unused-vars',
])

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
    child.stdout.on('data', data => stdout += data)
    child.stderr.on('data', data => stderr += data)
    child.on('error', reject)
    child.on('close', status => resolve({ status, stdout, stderr }))
  })
}

function parseEslintJson(stdout) {
  if (!stdout.trim())
    return []

  return JSON.parse(stdout)
}

function relativeMessage(file, message) {
  const filePath = path.relative(repoRoot, file.filePath)
  return `${filePath}:${message.line}:${message.column} ${message.ruleId} ${message.message}`
}

async function ensureCleanWorktree() {
  const result = await run('git', ['status', '--porcelain=v1'], { cwd: repoRoot })
  if (result.status !== 0) {
    process.stderr.write(result.stderr)
    throw new Error('Failed to check git status.')
  }

  if (!result.stdout.trim())
    return

  console.error('This check runs knip --fix and must start from a clean worktree.')
  console.error('Commit or stash your changes first, then run it again.')
  console.error(result.stdout)
  process.exit(1)
}

async function restoreWorktree() {
  const restoreResult = await run('git', ['restore', '--staged', '--worktree', '.'], { cwd: repoRoot })
  if (restoreResult.status !== 0) {
    process.stdout.write(restoreResult.stdout)
    process.stderr.write(restoreResult.stderr)
    throw new Error('Failed to restore tracked files after knip --fix.')
  }

  const cleanResult = await run('git', ['clean', '-fd', '--', 'web', '.eslintcache'], { cwd: repoRoot })
  if (cleanResult.status !== 0) {
    process.stdout.write(cleanResult.stdout)
    process.stderr.write(cleanResult.stderr)
    throw new Error('Failed to clean untracked files after knip --fix.')
  }
}

const knip = path.join(webDir, 'node_modules', '.bin', commandName('knip'))
const eslint = path.join(repoRoot, 'node_modules', '.bin', commandName('eslint'))
let shouldRestore = false
let hasFatalMessages = false
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

  console.log('Running ESLint unused checks after knip --fix...')
  const eslintResult = await run(eslint, [
    '--cache',
    '--concurrency=auto',
    '--quiet',
    '--format',
    'json',
    '--pass-on-unpruned-suppressions',
    'web',
  ], { cwd: repoRoot })

  let eslintOutput
  try {
    eslintOutput = parseEslintJson(eslintResult.stdout)
  }
  catch {
    process.stdout.write(eslintResult.stdout)
    process.stderr.write(eslintResult.stderr)
    throw new Error('Failed to parse ESLint JSON output.')
  }

  const fatalMessages = []
  const unusedMessages = []
  const otherMessages = []
  for (const file of eslintOutput) {
    for (const message of file.messages ?? []) {
      if (message.fatal)
        fatalMessages.push(relativeMessage(file, message))
      else if (UNUSED_RULES.has(message.ruleId))
        unusedMessages.push(relativeMessage(file, message))
      else
        otherMessages.push(relativeMessage(file, message))
    }
  }

  if (fatalMessages.length > 0) {
    hasFatalMessages = true
    console.error('ESLint reported fatal errors after knip --fix.')
    for (const message of fatalMessages)
      console.error(message)
  }

  if (otherMessages.length > 0) {
    console.warn(`Ignoring ${otherMessages.length} non-unused ESLint message(s) produced after knip --fix.`)
    for (const message of otherMessages.slice(0, 20))
      console.warn(message)
    if (otherMessages.length > 20)
      console.warn(`...and ${otherMessages.length - 20} more.`)
  }

  if (unusedMessages.length > 0) {
    hasUnusedMessages = true
    console.error('Unused declarations remain after applying knip --production --fix.')
    console.error('Remove these declarations; if they are only referenced by tests, remove the matching tests too.')
    for (const message of unusedMessages)
      console.error(message)
  }
  else {
    console.log('No ESLint unused declarations remain after knip --production --fix.')
  }
}
finally {
  if (shouldRestore) {
    console.log('Restoring checkout after knip --fix...')
    await restoreWorktree()
  }
}

if (hasFatalMessages || hasUnusedMessages)
  process.exit(1)
