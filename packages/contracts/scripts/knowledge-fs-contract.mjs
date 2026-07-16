import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(packageRoot, '../..')
const generatedDirectory = join(packageRoot, 'generated/knowledge-fs')
const lockPath = join(packageRoot, 'knowledge-fs-contract.lock.json')
const defaultKnowledgeFsRepository = resolve(workspaceRoot, '../knowledge-fs')

const mode = process.argv[2]
const checkOnly = mode === '--check'
const updateLock = mode === '--update-lock'
const verifyGeneratedOnly = mode === '--verify-generated'

if (mode && !checkOnly && !updateLock && !verifyGeneratedOnly)
  throw new Error(`Unknown KnowledgeFS contract option: ${mode}`)

const lock = JSON.parse(await readFile(lockPath, 'utf8'))

if (verifyGeneratedOnly) {
  await assertGeneratedHash(lock.generatedSha256)
  console.log(`Verified KnowledgeFS generated contract from ${lock.commit}`)
  process.exit(0)
}

const knowledgeFsRepository = resolve(process.env.KNOWLEDGE_FS_REPO ?? defaultKnowledgeFsRepository)
const trackedChanges = run(
  'git',
  ['status', '--porcelain', '--untracked-files=no'],
  knowledgeFsRepository,
).trim()
if (trackedChanges) {
  throw new Error('KnowledgeFS checkout must not contain tracked changes during contract export')
}
const commit = run('git', ['rev-parse', 'HEAD'], knowledgeFsRepository).trim()

if (!updateLock && commit !== lock.commit) {
  throw new Error(
    `KnowledgeFS checkout mismatch: expected ${lock.commit}, received ${commit}. ` +
      'Use the pinned commit or run with --update-lock intentionally.',
  )
}

const temporaryDirectory = await mkdtemp(join(tmpdir(), 'dify-knowledge-fs-contract-'))

try {
  const openapiPath = join(temporaryDirectory, 'knowledge-fs.openapi.json')
  run('pnpm', ['openapi:export', '--', '--output', openapiPath], knowledgeFsRepository, true)
  const openapiSha256 = sha256(await readFile(openapiPath))

  if (!updateLock && openapiSha256 !== lock.openapiSha256) {
    throw new Error(
      `KnowledgeFS OpenAPI hash mismatch: expected ${lock.openapiSha256}, received ${openapiSha256}`,
    )
  }

  const outputDirectory = checkOnly
    ? join(temporaryDirectory, 'generated/knowledge-fs')
    : generatedDirectory
  run(
    'pnpm',
    ['exec', 'openapi-ts', '-f', 'openapi-ts.knowledge-fs.config.ts'],
    packageRoot,
    true,
    {
      KNOWLEDGE_FS_OPENAPI: openapiPath,
      KNOWLEDGE_FS_OUTPUT: outputDirectory,
    },
  )
  run('pnpm', ['exec', 'vp', 'fmt', outputDirectory], packageRoot, true)

  const generatedSha256 = await hashDirectory(outputDirectory)
  if (updateLock) {
    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          commit,
          generatedSha256,
          openapiSha256,
          repository: lock.repository,
        },
        null,
        2,
      )}\n`,
    )
    console.log(`Updated KnowledgeFS contract lock to ${commit}`)
  } else {
    if (generatedSha256 !== lock.generatedSha256) {
      throw new Error(
        `Generated KnowledgeFS contract drifted: expected ${lock.generatedSha256}, received ${generatedSha256}`,
      )
    }
    if (checkOnly) await assertGeneratedHash(generatedSha256)
    console.log(`${checkOnly ? 'Checked' : 'Generated'} KnowledgeFS contract from ${commit}`)
  }
} finally {
  await rm(temporaryDirectory, { force: true, recursive: true })
}

async function assertGeneratedHash(expectedHash) {
  const actualHash = await hashDirectory(generatedDirectory)
  if (actualHash !== expectedHash) {
    throw new Error(
      `Committed KnowledgeFS contract drifted: expected ${expectedHash}, received ${actualHash}`,
    )
  }
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex')
}

async function hashDirectory(directory) {
  const files = await listFiles(directory)
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(relative(directory, file).replaceAll('\\', '/'))
    hash.update('\0')
    hash.update(await readFile(file))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return files.flat().sort()
}

function run(command, args, cwd, inherit = false, extraEnv = {}) {
  return (
    execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, ...extraEnv },
      stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'inherit'],
    }) ?? ''
  )
}
