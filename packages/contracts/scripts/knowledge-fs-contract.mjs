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
const proxyRoutesPath = join(workspaceRoot, 'api/services/knowledge_fs_contract_routes.py')
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
  await assertProxyRoutesHash(lock.proxyRoutesSha256)
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
  const openapiContent = await readFile(openapiPath)
  const openapiSha256 = sha256(openapiContent)

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
  const proxyRoutesOutputPath = checkOnly
    ? join(temporaryDirectory, 'knowledge_fs_contract_routes.py')
    : proxyRoutesPath
  const proxyRoutesContent = renderProxyRoutes(JSON.parse(openapiContent.toString('utf8')))
  await writeFile(proxyRoutesOutputPath, proxyRoutesContent)
  const proxyRoutesSha256 = sha256(proxyRoutesContent)
  if (updateLock) {
    await writeFile(
      lockPath,
      `${JSON.stringify(
        {
          commit,
          generatedSha256,
          openapiSha256,
          proxyRoutesSha256,
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
    if (proxyRoutesSha256 !== lock.proxyRoutesSha256) {
      throw new Error(
        `KnowledgeFS proxy routes drifted: expected ${lock.proxyRoutesSha256}, received ${proxyRoutesSha256}`,
      )
    }
    if (checkOnly) {
      await assertGeneratedHash(generatedSha256)
      await assertProxyRoutesHash(proxyRoutesSha256)
    }
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

async function assertProxyRoutesHash(expectedHash) {
  const actualHash = sha256(await readFile(proxyRoutesPath))
  if (actualHash !== expectedHash) {
    throw new Error(
      `Committed KnowledgeFS proxy routes drifted: expected ${expectedHash}, received ${actualHash}`,
    )
  }
}

function renderProxyRoutes(document) {
  const openApiMethods = ['delete', 'get', 'head', 'options', 'patch', 'post', 'put', 'trace']
  const proxyMethods = new Set(['delete', 'get', 'patch', 'post', 'put'])
  const routes = []

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!path.startsWith('/')) throw new Error(`KnowledgeFS OpenAPI path must be absolute: ${path}`)
    for (const method of openApiMethods) {
      if (!pathItem[method]) continue
      if (!proxyMethods.has(method)) {
        throw new Error(`KnowledgeFS proxy does not support ${method.toUpperCase()} ${path}`)
      }
      routes.push([
        method.toUpperCase(),
        path.slice(1),
        responseKind(pathItem[method]),
        requiredAccess(pathItem[method]),
      ])
    }
  }

  routes.sort(([leftMethod, leftPath], [rightMethod, rightPath]) =>
    leftPath === rightPath
      ? leftMethod.localeCompare(rightMethod)
      : leftPath.localeCompare(rightPath),
  )
  const entries = routes
    .map(
      ([method, path, kind, access]) =>
        `        (\n            ${JSON.stringify(method)},\n            ${JSON.stringify(path)},\n            ${JSON.stringify(kind)},\n            ${JSON.stringify(access)},\n        ),`,
    )
    .join('\n')

  return `"""Generated KnowledgeFS operations used by the Console proxy."""\n\nfrom typing import Final\n\n# Generated by packages/contracts/scripts/knowledge-fs-contract.mjs. Do not edit.\nKNOWLEDGE_FS_CONTRACT_OPERATIONS: Final[frozenset[tuple[str, str, str, str]]] = frozenset(\n    {\n${entries}\n    }\n)\n`
}

function responseKind(operation) {
  const mediaTypes = Object.values(operation.responses ?? {}).flatMap((response) =>
    Object.keys(response.content ?? {}),
  )
  if (mediaTypes.includes('text/event-stream')) return 'stream'
  if (mediaTypes.includes('application/octet-stream')) return 'binary'
  return 'buffered'
}

function requiredAccess(operation) {
  const scope = operation['x-knowledge-fs-required-scope']
  if (scope === 'knowledge-spaces:read') return 'read'
  if (scope === 'knowledge-spaces:write') return 'write'
  throw new Error(`KnowledgeFS operation has no supported required scope: ${scope}`)
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
