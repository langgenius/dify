const { execFileSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const sourcePaths = [
  'web',
  'packages',
  'e2e/scripts',
  'e2e/package.json',
  'e2e/test-env.ts',
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  '.npmrc',
  '.github/actions/setup-web',
  '.github/workflows/web-e2e.yml',
]
const cacheDir = 'web/.next/cache'
const metadataPath = `${cacheDir}/dify-e2e-inputs.json`
const logDir = 'e2e/.logs'
const snapshotPath = `${logDir}/web-build-inputs.json`
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)

function getInputs() {
  const tree = execFileSync('git', ['ls-tree', '-r', '-z', 'HEAD', '--', ...sourcePaths], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const files = Object.fromEntries(
    tree
      .split('\0')
      .filter(Boolean)
      .map((entry) => {
        const tab = entry.indexOf('\t')
        return [entry.slice(tab + 1), entry.slice(0, tab)]
      }),
  )
  return {
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    sourceHash: process.env.E2E_BUILD_SOURCE_HASH,
    node: process.version,
    next: readJson('web/node_modules/next/package.json')?.version,
    // Only hashes are retained, never environment file contents.
    envFileHash: fs.existsSync('web/.env.local') ? sha256(fs.readFileSync('web/.env.local')) : null,
    files,
  }
}

function compareInputs(previous, current) {
  if (!previous) return null
  return {
    previousCommit: previous.commit,
    changedFiles: [...new Set([...Object.keys(previous.files), ...Object.keys(current.files)])]
      .filter((file) => previous.files[file] !== current.files[file])
      .sort(),
    nodeChanged: previous.node !== current.node,
    nextChanged: previous.next !== current.next,
    envFileChanged: previous.envFileHash !== current.envFileHash,
  }
}

function cacheSize(directory) {
  if (!fs.existsSync(directory)) return 0
  return fs.readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const file = path.join(directory, entry.name)
    return (
      total + (entry.isDirectory() ? cacheSize(file) : entry.isFile() ? fs.statSync(file).size : 0)
    )
  }, 0)
}

function report(entry) {
  const line = JSON.stringify(entry)
  console.log(`[e2e:build] ${line}`)
  fs.appendFileSync(`${logDir}/web-build-diagnostics.log`, `${line}\n`)
  if (process.env.GITHUB_STEP_SUMMARY) {
    // JSON encodes newlines; escape backticks/HTML before embedding untrusted filenames.
    const summary = entry.comparison
      ? {
          ...entry,
          comparison: {
            ...entry.comparison,
            changedFileCount: entry.comparison.changedFiles.length,
            changedFiles: entry.comparison.changedFiles.slice(0, 50),
          },
        }
      : entry
    const safe = JSON.stringify(summary, null, 2)
      .replaceAll('`', '\\u0060')
      .replaceAll('<', '\\u003c')
      .replaceAll('>', '\\u003e')
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### E2E build diagnostics (${entry.phase})\n\n\`\`\`json\n${safe}\n\`\`\`\n`,
    )
  }
}

function main(mode) {
  fs.mkdirSync(logDir, { recursive: true })
  if (mode === 'before') {
    const current = getInputs()
    const previous = readJson(metadataPath)
    fs.writeFileSync(snapshotPath, JSON.stringify(current))
    const matchedKey = process.env.E2E_CACHE_MATCHED_KEY || null
    report({
      phase: 'cache.restore',
      // This brackets the restore action and includes step transition overhead.
      durationMs: Date.now() - Number(process.env.E2E_CACHE_RESTORE_STARTED),
      match: process.env.E2E_CACHE_HIT === 'true' ? 'exact' : matchedKey ? 'fallback' : 'miss',
      primaryKey: process.env.E2E_CACHE_PRIMARY_KEY,
      matchedKey,
      cacheBytes: cacheSize(cacheDir),
      node: current.node,
      next: current.next,
      sourceHash: current.sourceHash,
      comparison: compareInputs(previous, current),
      note: previous
        ? 'Input differences are evidence, not proof of compiler cache invalidation.'
        : 'Restored cache has no diagnostic baseline yet.',
    })
  } else if (mode === 'after') {
    const buildLog = fs.existsSync(`${logDir}/web-build.log`)
      ? fs.readFileSync(`${logDir}/web-build.log`, 'utf8')
      : ''
    const cleanLog = buildLog.replace(/\u001B\[[0-9;]*m/g, '')
    const compilation = cleanLog.match(/Compiled successfully in ([\d.]+)(ms|min|s)/)
    const compilerDurationMs = compilation
      ? Number(compilation[1]) * { ms: 1, s: 1000, min: 60000 }[compilation[2]]
      : null
    report({
      phase: 'web.build',
      compilerDurationMs,
      outcome: process.env.E2E_BUILD_OUTCOME,
      cacheBytes: cacheSize(cacheDir),
      // Next reports its compiler duration separately from full build wall time.
      compilerMessages: cleanLog
        .split('\n')
        .filter((line) => /Compiled successfully|Generating static pages.* in /.test(line)),
    })
    if (process.env.E2E_BUILD_OUTCOME === 'success' && fs.existsSync(snapshotPath)) {
      fs.mkdirSync(cacheDir, { recursive: true })
      fs.copyFileSync(snapshotPath, metadataPath)
    }
  } else {
    throw new Error(`Unknown diagnostic mode: ${mode}`)
  }
}

module.exports = { compareInputs }
if (require.main === module) {
  try {
    main(process.argv[2])
  } catch (error) {
    // Observability must not change build/cache behavior.
    console.warn('Could not collect E2E build diagnostics:', error.message)
  }
}
