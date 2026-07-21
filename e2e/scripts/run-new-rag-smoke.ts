import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { e2eDir, isMainModule, runCommand } from './common'
import { resetState } from './setup'

type SmokeEnvironment = NodeJS.ProcessEnv

export type NewRagSmokeConfig = {
  connectionCredentials: Record<string, string>
  crawlUrl: string
  knowledgeFsBaseUrl: string
  knowledgeFsJwtSecret: string
}

export type NewRagSmokeRun = {
  env: SmokeEnvironment
  label: 'default-disabled' | 'explicit-disabled' | 'enabled-happy-path'
  preserveState: boolean
  tag: '@new-rag-flag-default' | '@new-rag-flag-disabled' | '@new-rag-happy-path'
}

const knowledgeFsEnvironmentKeys = [
  'KNOWLEDGE_FS_BASE_URL',
  'KNOWLEDGE_FS_ENABLED',
  'KNOWLEDGE_FS_JWT_SECRET',
] as const

const providerSecretEnvironmentKeys = [
  'E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON',
  'E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET',
] as const

const executionOverrideEnvironmentKeys = ['E2E_CUCUMBER_TAGS', 'E2E_REUSE_WEB_SERVER'] as const

const required = (env: SmokeEnvironment, name: string) => {
  const value = env[name]?.trim()
  if (!value) throw new Error(`${name} is required for the New RAG smoke test.`)
  return value
}

const httpUrl = (env: SmokeEnvironment, name: string, trimTrailingSlash: boolean) => {
  const value = required(env, name)
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(`${name} must be an absolute HTTP(S) URL.`)
  }

  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error(`${name} must be an absolute HTTP(S) URL without credentials.`)

  const normalized = url.toString()
  return trimTrailingSlash ? normalized.replace(/\/$/, '') : normalized
}

const connectionCredentials = (env: SmokeEnvironment) => {
  const value = required(env, 'E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON')
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error('E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON must be a JSON object.')
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON must be a JSON object.')

  const entries = Object.entries(parsed)
  if (
    entries.length === 0 ||
    entries.some(
      ([name, credential]) => !name.trim() || typeof credential !== 'string' || !credential.trim(),
    )
  )
    throw new Error(
      'E2E_NEW_RAG_CONNECTION_CREDENTIALS_JSON must contain non-empty string credentials.',
    )

  return Object.fromEntries(entries.map(([name, credential]) => [name, credential.trim()]))
}

export const resolveNewRagSmokeConfig = (env: SmokeEnvironment): NewRagSmokeConfig => {
  const knowledgeFsBaseUrl = httpUrl(env, 'E2E_NEW_RAG_KNOWLEDGE_FS_BASE_URL', true)
  const knowledgeFsJwtSecret = required(env, 'E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET')
  if (knowledgeFsJwtSecret.length < 32)
    throw new Error('E2E_NEW_RAG_KNOWLEDGE_FS_JWT_SECRET must contain at least 32 characters.')

  return {
    connectionCredentials: connectionCredentials(env),
    crawlUrl: httpUrl(env, 'E2E_NEW_RAG_CRAWL_URL', false),
    knowledgeFsBaseUrl,
    knowledgeFsJwtSecret,
  }
}

const withoutKnowledgeFsConfiguration = (source: SmokeEnvironment) => {
  const env = { ...source }
  for (const key of knowledgeFsEnvironmentKeys) delete env[key]
  for (const key of providerSecretEnvironmentKeys) delete env[key]
  return env
}

const withoutExecutionOverrides = (source: SmokeEnvironment) => {
  const env = { ...source }
  for (const key of executionOverrideEnvironmentKeys) delete env[key]
  return env
}

export const buildNewRagSmokeRuns = (source: SmokeEnvironment): NewRagSmokeRun[] => {
  const config = resolveNewRagSmokeConfig(source)
  const isolatedSource = withoutExecutionOverrides(source)
  const disabledBase = withoutKnowledgeFsConfiguration(isolatedSource)

  return [
    {
      env: {
        ...disabledBase,
        E2E_NEW_RAG_EXPECTED_FLAG_MODE: 'default-disabled',
      },
      label: 'default-disabled',
      preserveState: false,
      tag: '@new-rag-flag-default',
    },
    {
      env: {
        ...disabledBase,
        E2E_NEW_RAG_EXPECTED_FLAG_MODE: 'explicit-disabled',
        KNOWLEDGE_FS_ENABLED: 'false',
      },
      label: 'explicit-disabled',
      preserveState: true,
      tag: '@new-rag-flag-disabled',
    },
    {
      env: {
        ...isolatedSource,
        E2E_NEW_RAG_CRAWL_URL: config.crawlUrl,
        E2E_NEW_RAG_EXPECTED_FLAG_MODE: 'enabled',
        E2E_NEW_RAG_KNOWLEDGE_FS_BASE_URL: config.knowledgeFsBaseUrl,
        KNOWLEDGE_FS_BASE_URL: config.knowledgeFsBaseUrl,
        KNOWLEDGE_FS_ENABLED: 'true',
        KNOWLEDGE_FS_JWT_SECRET: config.knowledgeFsJwtSecret,
      },
      label: 'enabled-happy-path',
      preserveState: true,
      tag: '@new-rag-happy-path',
    },
  ]
}

export const newRagCucumberArgs = (tag: NewRagSmokeRun['tag'], preserveState: boolean) => [
  'exec',
  'tsx',
  './scripts/run-cucumber.ts',
  '--full',
  ...(preserveState ? ['--preserve-state'] : []),
  '--',
  '--tags',
  tag,
]

const requireKnowledgeFsHealth = async (baseUrl: string) => {
  const healthUrl = new URL('/health', `${baseUrl}/`)
  const response = await fetch(healthUrl, { signal: AbortSignal.timeout(10_000) }).catch(
    (error: unknown) => {
      throw new Error(
        `KnowledgeFS is not reachable at ${healthUrl}: ${error instanceof Error ? error.message : String(error)}`,
      )
    },
  )
  if (!response.ok)
    throw new Error(
      `KnowledgeFS health check failed with ${response.status} ${response.statusText}.`,
    )
}

const main = async () => {
  const config = resolveNewRagSmokeConfig(process.env)
  await requireKnowledgeFsHealth(config.knowledgeFsBaseUrl)
  const stateDirectory = await mkdtemp(path.join(tmpdir(), 'dify-new-rag-smoke-'))
  const smokeEnvironment = {
    ...process.env,
    E2E_NEW_RAG_LEGACY_DATASET_NAME: `Legacy flag ${Date.now().toString(36)}`,
    E2E_NEW_RAG_LEGACY_DATASET_STATE_PATH: path.join(stateDirectory, 'legacy-dataset.json'),
  }

  try {
    for (const run of buildNewRagSmokeRuns(smokeEnvironment)) {
      console.warn(`[new-rag-smoke] start ${run.label}`)
      const result = await runCommand({
        command: 'pnpm',
        args: newRagCucumberArgs(run.tag, run.preserveState),
        cwd: e2eDir,
        env: run.env,
        inheritEnv: false,
      })
      if (result.exitCode !== 0)
        throw new Error(`New RAG smoke run ${run.label} failed with exit code ${result.exitCode}.`)
    }
  } finally {
    try {
      await resetState({ preserveArtifacts: true })
    } finally {
      await rm(stateDirectory, { force: true, recursive: true })
    }
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
