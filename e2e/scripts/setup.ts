import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { waitForUrl } from '../support/process'
import {
  apiDir,
  apiEnvExampleFile,
  difyAgentDir,
  dockerDir,
  e2eDir,
  e2eWebEnvOverrides,
  ensureFileExists,
  ensureLineInFile,
  getTcpPortListenerDescription,
  getWebEnvLocalHash,
  isMainModule,
  isTcpPortReachable,
  middlewareComposeFile,
  middlewareEnvExampleFile,
  middlewareEnvFile,
  readSimpleDotenv,
  rootDir,
  runCommand,
  runCommandOrThrow,
  runForegroundProcess,
  waitForCondition,
  webDir,
} from './common'

const buildIdPath = path.join(webDir, '.next', 'BUILD_ID')
const webBuildStampPath = path.join(webDir, '.next', 'e2e-web-build.sha256')
const apiHost = '127.0.0.1'
const apiPort = 5001
const agentBackendHost = '127.0.0.1'
const agentBackendBindHost = '0.0.0.0'
const agentBackendPort = Number(process.env.E2E_AGENT_BACKEND_PORT || 5050)
const shellctlHost = '127.0.0.1'
const shellctlPort = Number(process.env.E2E_SHELLCTL_PORT || 5004)
const shellctlContainerName = process.env.E2E_SHELLCTL_CONTAINER_NAME || 'dify-agent-e2e-shellctl'
const shellctlImage = process.env.E2E_SHELLCTL_IMAGE || 'dify-agent-local-sandbox:e2e'
const shellctlUrl = `http://${shellctlHost}:${shellctlPort}`
const agentStubApiBaseUrl = `http://host.docker.internal:${agentBackendPort}/agent-stub`
const defaultPluginDaemonKey = 'lYkiYYT6owG+71oLerGzA7GXCgOT++6ovaezWAjpCjf+Sjc3ZtU+qUEi'
const defaultInnerApiKeyForPlugin = 'QaHbTe77CtuXmsfyhR7+vRjI/+XbV1AaFy691iy+kGDv2Jvy0/eAh8Y1'
const defaultAgentServerSecretKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY'

const middlewareDataPaths = [
  path.join(dockerDir, 'volumes', 'db', 'data'),
  path.join(dockerDir, 'volumes', 'plugin_daemon'),
  path.join(dockerDir, 'volumes', 'redis', 'data'),
  path.join(dockerDir, 'volumes', 'weaviate'),
]

const e2eStatePaths = [
  path.join(e2eDir, '.auth'),
  path.join(e2eDir, 'cucumber-report'),
  path.join(e2eDir, '.logs'),
  path.join(e2eDir, 'playwright-report'),
  path.join(e2eDir, 'test-results'),
]

const composeArgs = [
  'compose',
  '-f',
  middlewareComposeFile,
  '--profile',
  'postgresql',
  '--profile',
  'weaviate',
]

const getApiEnvironment = async (): Promise<Record<string, string>> => {
  const envFromExample = await readSimpleDotenv(apiEnvExampleFile)
  const agentBackendBaseUrl = getAgentBackendBaseUrl()

  return {
    ...envFromExample,
    ...(agentBackendBaseUrl ? { AGENT_BACKEND_BASE_URL: agentBackendBaseUrl } : {}),
    FLASK_APP: 'app.py',
  }
}

function getAgentBackendBaseUrl() {
  const explicitApiUrl = process.env.AGENT_BACKEND_BASE_URL?.trim()
  if (explicitApiUrl) return explicitApiUrl

  const explicitE2EUrl = process.env.E2E_AGENT_BACKEND_URL?.trim()
  if (explicitE2EUrl) return explicitE2EUrl.replace(/\/$/, '')

  if (process.env.E2E_START_AGENT_BACKEND === '1' || process.env.E2E_START_AGENT_BACKEND === 'true')
    return `http://${agentBackendHost}:${agentBackendPort}`

  return undefined
}

const getAgentBackendEnvironment = async () => {
  const apiEnv = await getApiEnvironment()
  const redisPassword = process.env.REDIS_PASSWORD || apiEnv.REDIS_PASSWORD || 'difyai123456'

  return {
    DIFY_AGENT_INNER_API_KEY:
      process.env.DIFY_AGENT_INNER_API_KEY ||
      process.env.INNER_API_KEY_FOR_PLUGIN ||
      process.env.PLUGIN_DIFY_INNER_API_KEY ||
      apiEnv.INNER_API_KEY_FOR_PLUGIN ||
      defaultInnerApiKeyForPlugin,
    DIFY_AGENT_INNER_API_URL:
      process.env.DIFY_AGENT_INNER_API_URL || `http://${apiHost}:${apiPort}`,
    DIFY_AGENT_SERVER_SECRET_KEY:
      process.env.DIFY_AGENT_SERVER_SECRET_KEY || defaultAgentServerSecretKey,
    DIFY_AGENT_STUB_API_BASE_URL: process.env.DIFY_AGENT_STUB_API_BASE_URL || agentStubApiBaseUrl,
    DIFY_AGENT_PLUGIN_DAEMON_API_KEY:
      process.env.DIFY_AGENT_PLUGIN_DAEMON_API_KEY ||
      process.env.PLUGIN_DAEMON_KEY ||
      apiEnv.PLUGIN_DAEMON_KEY ||
      defaultPluginDaemonKey,
    DIFY_AGENT_PLUGIN_DAEMON_URL:
      process.env.DIFY_AGENT_PLUGIN_DAEMON_URL ||
      process.env.PLUGIN_DAEMON_URL ||
      'http://127.0.0.1:5002',
    DIFY_AGENT_REDIS_PREFIX: process.env.DIFY_AGENT_REDIS_PREFIX || 'dify-agent-e2e',
    DIFY_AGENT_REDIS_URL:
      process.env.DIFY_AGENT_REDIS_URL || `redis://:${redisPassword}@127.0.0.1:6379/0`,
    DIFY_AGENT_SHELLCTL_AUTH_TOKEN:
      process.env.DIFY_AGENT_SHELLCTL_AUTH_TOKEN || process.env.E2E_SHELLCTL_AUTH_TOKEN || '',
    DIFY_AGENT_SHELLCTL_ENTRYPOINT:
      process.env.DIFY_AGENT_SHELLCTL_ENTRYPOINT || process.env.E2E_SHELLCTL_URL || shellctlUrl,
  }
}

const getServiceContainerId = async (service: string) => {
  const result = await runCommandOrThrow({
    command: 'docker',
    args: ['compose', '-f', middlewareComposeFile, 'ps', '-q', service],
    cwd: dockerDir,
    stdio: 'pipe',
  })

  return result.stdout.trim()
}

const getContainerHealth = async (containerId: string) => {
  const result = await runCommand({
    command: 'docker',
    args: ['inspect', '-f', '{{.State.Health.Status}}', containerId],
    cwd: dockerDir,
    stdio: 'pipe',
  })

  if (result.exitCode !== 0) return ''

  return result.stdout.trim()
}

const printComposeLogs = async (services: string[]) => {
  await runCommand({
    command: 'docker',
    args: ['compose', '-f', middlewareComposeFile, 'logs', ...services],
    cwd: dockerDir,
  })
}

const waitForDependency = async ({
  description,
  services,
  wait,
}: {
  description: string
  services: string[]
  wait: () => Promise<void>
}) => {
  console.log(`Waiting for ${description}...`)

  try {
    await wait()
  } catch (error) {
    await printComposeLogs(services)
    throw error
  }
}

const webBuildSourcePaths = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'packages',
  'web',
]

const getWebBuildSourceHash = async () => {
  const hash = createHash('sha256')
  const gitArgsSuffix = ['--', ...webBuildSourcePaths]
  const commands = [
    ['rev-parse', 'HEAD'],
    ['diff', '--binary', ...gitArgsSuffix],
    ['diff', '--cached', '--binary', ...gitArgsSuffix],
  ]

  for (const args of commands) {
    const result = await runCommandOrThrow({
      command: 'git',
      args,
      cwd: rootDir,
      stdio: 'pipe',
    })

    hash.update(args.join(' '))
    hash.update('\n')
    hash.update(result.stdout)
    hash.update('\n')
  }

  const untrackedFiles = await runCommandOrThrow({
    command: 'git',
    args: ['ls-files', '--others', '--exclude-standard', '-z', ...gitArgsSuffix],
    cwd: rootDir,
    stdio: 'pipe',
  })

  for (const file of untrackedFiles.stdout.split('\0').filter(Boolean)) {
    hash.update(file)
    hash.update('\0')
    hash.update(await readFile(path.join(rootDir, file)))
    hash.update('\0')
  }

  return hash.digest('hex')
}

export const ensureWebBuild = async () => {
  const envHash = await getWebEnvLocalHash()
  const sourceHash = await getWebBuildSourceHash()
  const buildStamp = createHash('sha256')
    .update(envHash)
    .update('\n')
    .update(sourceHash)
    .digest('hex')
  const buildEnv = {
    ...e2eWebEnvOverrides,
  }

  if (process.env.E2E_FORCE_WEB_BUILD === '1') {
    await runCommandOrThrow({
      command: 'pnpm',
      args: ['run', 'build'],
      cwd: webDir,
      env: buildEnv,
    })
    await writeFile(webBuildStampPath, `${buildStamp}\n`, 'utf8')
    return
  }

  try {
    const [buildExists, previousBuildStamp] = await Promise.all([
      access(buildIdPath)
        .then(() => true)
        .catch(() => false),
      readFile(webBuildStampPath, 'utf8')
        .then((value) => value.trim())
        .catch(() => ''),
    ])

    if (buildExists && previousBuildStamp === buildStamp) {
      console.log('Reusing existing web build artifact.')
      return
    }
  } catch {
    // Fall through to rebuild when the existing build cannot be verified.
  }

  await runCommandOrThrow({
    command: 'pnpm',
    args: ['run', 'build'],
    cwd: webDir,
    env: buildEnv,
  })
  await writeFile(webBuildStampPath, `${buildStamp}\n`, 'utf8')
}

export const startWeb = async () => {
  await ensureWebBuild()

  await runForegroundProcess({
    command: 'pnpm',
    args: ['run', 'start'],
    cwd: webDir,
    env: {
      ...e2eWebEnvOverrides,
      HOSTNAME: '127.0.0.1',
      PORT: '3000',
    },
  })
}

export const startApi = async () => {
  if (await isTcpPortReachable(apiHost, apiPort)) {
    const listenerDescription = await getTcpPortListenerDescription(apiPort)
    const listenerMessage = listenerDescription ? `\n\nPort listener:\n${listenerDescription}` : ''

    throw new Error(
      `Cannot start the E2E API server because ${apiHost}:${apiPort} is already in use.${listenerMessage}`,
    )
  }

  const env = await getApiEnvironment()

  await runCommandOrThrow({
    command: 'uv',
    args: ['run', '--project', '.', '--no-sync', 'flask', 'upgrade-db'],
    cwd: apiDir,
    env,
  })

  await runForegroundProcess({
    command: 'uv',
    args: [
      'run',
      '--project',
      '.',
      '--no-sync',
      'flask',
      'run',
      '--host',
      apiHost,
      '--port',
      String(apiPort),
    ],
    cwd: apiDir,
    env,
  })
}

export const startAgentBackend = async () => {
  if (await isTcpPortReachable(agentBackendHost, agentBackendPort)) {
    const listenerDescription = await getTcpPortListenerDescription(agentBackendPort)
    const listenerMessage = listenerDescription ? `\n\nPort listener:\n${listenerDescription}` : ''

    throw new Error(
      `Cannot start the E2E Agent backend because ${agentBackendHost}:${agentBackendPort} is already in use.${listenerMessage}`,
    )
  }

  await runForegroundProcess({
    command: 'uv',
    args: [
      'run',
      '--project',
      '.',
      '--extra',
      'server',
      'uvicorn',
      'dify_agent.server.app:app',
      '--host',
      agentBackendBindHost,
      '--port',
      String(agentBackendPort),
    ],
    cwd: difyAgentDir,
    env: await getAgentBackendEnvironment(),
  })
}

const ensureShellctlSandboxImage = async () => {
  const inspectResult = await runCommand({
    command: 'docker',
    args: ['image', 'inspect', shellctlImage],
    cwd: rootDir,
    stdio: 'pipe',
  })

  if (inspectResult.exitCode === 0 && process.env.E2E_FORCE_SHELLCTL_BUILD !== '1') return

  await runCommandOrThrow({
    command: 'docker',
    args: [
      'build',
      '-f',
      path.join(difyAgentDir, 'docker', 'local-sandbox', 'Dockerfile'),
      '-t',
      shellctlImage,
      '.',
    ],
    cwd: difyAgentDir,
  })
}

export const startShellctlSandbox = async () => {
  if (await isTcpPortReachable(shellctlHost, shellctlPort)) {
    const listenerDescription = await getTcpPortListenerDescription(shellctlPort)
    const listenerMessage = listenerDescription ? `\n\nPort listener:\n${listenerDescription}` : ''

    throw new Error(
      `Cannot start the E2E shellctl sandbox because ${shellctlHost}:${shellctlPort} is already in use.${listenerMessage}`,
    )
  }

  await runCommand({
    command: 'docker',
    args: ['rm', '-f', shellctlContainerName],
    cwd: rootDir,
    stdio: 'pipe',
  })

  await ensureShellctlSandboxImage()

  await runForegroundProcess({
    command: 'docker',
    args: [
      'run',
      '--rm',
      '--name',
      shellctlContainerName,
      ...(process.platform === 'linux' ? ['--add-host', 'host.docker.internal:host-gateway'] : []),
      '-p',
      `${shellctlHost}:${shellctlPort}:5004`,
      ...(process.env.E2E_SHELLCTL_AUTH_TOKEN
        ? ['-e', `SHELLCTL_AUTH_TOKEN=${process.env.E2E_SHELLCTL_AUTH_TOKEN}`]
        : []),
      shellctlImage,
    ],
    cwd: rootDir,
  })
}

export const startCelery = async ({ queues = 'workflow_based_app_execution' } = {}) => {
  const env = await getApiEnvironment()

  await runForegroundProcess({
    command: 'uv',
    args: [
      'run',
      '--project',
      '.',
      '--no-sync',
      'celery',
      '-A',
      'app.celery',
      'worker',
      '--pool',
      'solo',
      '--loglevel',
      'INFO',
      '-Q',
      queues,
    ],
    cwd: apiDir,
    env,
  })
}

export const stopMiddleware = async () => {
  await runCommandOrThrow({
    command: 'docker',
    args: [...composeArgs, 'down', '--remove-orphans'],
    cwd: dockerDir,
  })
}

export const resetState = async () => {
  console.log('Stopping middleware services...')
  try {
    await stopMiddleware()
  } catch {
    // Reset should continue even if middleware is already stopped.
  }

  console.log('Removing persisted middleware data...')
  await Promise.all(
    middlewareDataPaths.map(async (targetPath) => {
      await rm(targetPath, { force: true, recursive: true })
      await mkdir(targetPath, { recursive: true })
    }),
  )

  console.log('Removing E2E local state...')
  await Promise.all(
    e2eStatePaths.map((targetPath) => rm(targetPath, { force: true, recursive: true })),
  )

  console.log('E2E state reset complete.')
}

export const startMiddleware = async () => {
  await ensureFileExists(middlewareEnvFile, middlewareEnvExampleFile)
  await ensureLineInFile(middlewareEnvFile, 'COMPOSE_PROFILES=postgresql,weaviate')

  console.log('Starting middleware services...')
  await runCommandOrThrow({
    command: 'docker',
    args: [
      ...composeArgs,
      'up',
      '-d',
      'db_postgres',
      'redis',
      'weaviate',
      'sandbox',
      'ssrf_proxy',
      'plugin_daemon',
    ],
    cwd: dockerDir,
  })

  const [postgresContainerId, redisContainerId] = await Promise.all([
    getServiceContainerId('db_postgres'),
    getServiceContainerId('redis'),
  ])

  await waitForDependency({
    description: 'PostgreSQL and Redis health checks',
    services: ['db_postgres', 'redis'],
    wait: () =>
      waitForCondition({
        check: async () => {
          const [postgresStatus, redisStatus] = await Promise.all([
            getContainerHealth(postgresContainerId),
            getContainerHealth(redisContainerId),
          ])

          return postgresStatus === 'healthy' && redisStatus === 'healthy'
        },
        description: 'PostgreSQL and Redis health checks',
        intervalMs: 2_000,
        timeoutMs: 240_000,
      }),
  })

  await waitForDependency({
    description: 'Weaviate readiness',
    services: ['weaviate'],
    wait: () => waitForUrl('http://127.0.0.1:8080/v1/.well-known/ready', 120_000, 2_000),
  })

  await waitForDependency({
    description: 'sandbox health',
    services: ['sandbox', 'ssrf_proxy'],
    wait: () => waitForUrl('http://127.0.0.1:8194/health', 120_000, 2_000),
  })

  await waitForDependency({
    description: 'plugin daemon port',
    services: ['plugin_daemon'],
    wait: () =>
      waitForCondition({
        check: async () => isTcpPortReachable('127.0.0.1', 5002),
        description: 'plugin daemon port',
        intervalMs: 2_000,
        timeoutMs: 120_000,
      }),
  })

  console.log('Full middleware stack is ready.')
}

const printUsage = () => {
  console.log(
    'Usage: tsx ./scripts/setup.ts <reset|middleware-up|middleware-down|shellctl-sandbox|agent-backend|api|celery [--queues queues]|web>',
  )
}

const main = async () => {
  const command = process.argv[2]
  const queuesIndex = process.argv.indexOf('--queues')
  const queues = queuesIndex === -1 ? undefined : process.argv[queuesIndex + 1]

  switch (command) {
    case 'agent-backend':
      await startAgentBackend()
      return
    case 'api':
      await startApi()
      return
    case 'celery':
      await startCelery({ queues })
      return
    case 'middleware-down':
      await stopMiddleware()
      return
    case 'middleware-up':
      await startMiddleware()
      return
    case 'reset':
      await resetState()
      return
    case 'shellctl-sandbox':
      await startShellctlSandbox()
      return
    case 'web':
      await startWeb()
      return
    default:
      printUsage()
      process.exitCode = 1
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
