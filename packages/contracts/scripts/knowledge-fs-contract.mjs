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
        rbacPermission(method, path, pathItem[method]),
        requiredMaxResponseBytes(pathItem[method]),
        requestHeaderNames(pathItem, pathItem[method]),
        responseHeaderNames(pathItem[method]),
        responseMediaTypes(pathItem[method]),
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
      ([
        method,
        path,
        kind,
        access,
        permission,
        maxResponseBytes,
        requestHeaders,
        responseHeaders,
        responseMediaTypes,
      ]) =>
        `        (\n            ${JSON.stringify(method)},\n            ${JSON.stringify(path)},\n            ${JSON.stringify(kind)},\n            ${JSON.stringify(access)},\n            ${JSON.stringify(permission)},\n            ${maxResponseBytes},\n            ${pythonTuple(requestHeaders)},\n            ${pythonTuple(responseHeaders)},\n            ${pythonTuple(responseMediaTypes)},\n        ),`,
    )
    .join('\n')

  return `"""Generated KnowledgeFS operations used by the Console proxy."""\n\nfrom typing import Final\n\n# Generated by packages/contracts/scripts/knowledge-fs-contract.mjs. Do not edit.\nContractOperation = tuple[str, str, str, str, str, int, tuple[str, ...], tuple[str, ...], tuple[str, ...]]\nKNOWLEDGE_FS_CONTRACT_OPERATIONS: Final[frozenset[ContractOperation]] = frozenset(\n    {\n${entries}\n    }\n)\n`
}

function responseKind(operation) {
  const mediaTypes = responseMediaTypes(operation)
  if (mediaTypes.includes('text/event-stream')) return 'stream'
  if (mediaTypes.includes('application/octet-stream')) return 'binary'
  return 'buffered'
}

function responseMediaTypes(operation) {
  return Object.entries(operation.responses ?? {})
    .filter(([status]) => status === '2XX' || /^2\d\d$/.test(status))
    .flatMap(([, response]) => Object.keys(response.content ?? {}))
    .filter((mediaType, index, mediaTypes) => mediaTypes.indexOf(mediaType) === index)
    .sort()
}

function requiredAccess(operation) {
  const scope = operation['x-knowledge-fs-required-scope']
  if (scope === 'knowledge-spaces:read') return 'read'
  if (scope === 'knowledge-spaces:write') return 'write'
  // Console proxy routes remain authenticated even when the upstream operation is anonymous.
  if (Array.isArray(operation.security) && operation.security.length === 0) return 'read'
  throw new Error(`KnowledgeFS operation has no supported required scope: ${scope}`)
}

function rbacPermission(method, path, operation) {
  const normalizedMethod = method.toUpperCase()
  const isMutation = normalizedMethod !== 'GET'

  if (responseKind(operation) === 'binary') return 'dataset_document_download'
  if (isMutation && /^\/knowledge-spaces\/\{id\}\/api-keys(?:\/\{keyId\})?$/.test(path))
    return 'dataset_api_key_manage'
  if (
    isMutation &&
    (path === '/knowledge-spaces/{id}/access-bootstrap' ||
      path === '/knowledge-spaces/{id}/access-policy' ||
      path === '/knowledge-spaces/{id}/api-access' ||
      /^\/knowledge-spaces\/\{id\}\/members(?:\/\{subjectId\})?$/.test(path))
  )
    return 'dataset_access_config'
  if (
    isMutation &&
    (path === '/source-oauth/callback' ||
      path.startsWith('/knowledge-spaces/{id}/source-') ||
      path.startsWith('/knowledge-spaces/{id}/sources'))
  )
    return 'dataset_external_connect'
  if (isMutation && path.startsWith('/knowledge-spaces/{id}')) return 'dataset_edit'
  return requiredAccess(operation) === 'read' ? 'dataset_readonly' : 'dataset_create_and_management'
}

function requiredMaxResponseBytes(operation) {
  const value = operation['x-knowledge-fs-max-response-bytes']
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`KnowledgeFS operation has no valid response byte limit: ${value}`)
  }
  return value
}

function requestHeaderNames(pathItem, operation) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .flatMap((parameter) => {
      if ('$ref' in parameter) {
        throw new Error(
          `KnowledgeFS request header references are not supported: ${parameter.$ref}`,
        )
      }
      return parameter.in === 'header' ? [parameter.name.toLowerCase()] : []
    })
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort()
}

function responseHeaderNames(operation) {
  return Object.values(operation.responses ?? {})
    .flatMap((response) => Object.keys(response.headers ?? {}))
    .map((name) => name.toLowerCase())
    .filter((name, index, names) => names.indexOf(name) === index)
    .sort()
}

function pythonTuple(values) {
  if (values.length === 0) return '()'
  const entries = values.map((value) => JSON.stringify(value)).join(', ')
  const tuple = `(${entries}${values.length === 1 ? ',' : ''})`
  if (tuple.length <= 96) return tuple
  const multilineEntries = values
    .map((value) => `                ${JSON.stringify(value)},`)
    .join('\n')
  return `(\n${multilineEntries}\n            )`
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
