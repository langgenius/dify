import { access, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { waitForUrl } from '../support/process'
import {
  apiDir,
  apiEnvExampleFile,
  dockerDir,
  e2eDir,
  ensureFileExists,
  ensureLineInFile,
  ensureWebEnvLocal,
  isMainModule,
  isTcpPortReachable,
  middlewareComposeFile,
  middlewareEnvExampleFile,
  middlewareEnvFile,
  readSimpleDotenv,
  runCommand,
  runCommandOrThrow,
  runForegroundProcess,
  waitForCondition,
  webDir,
} from './common'

const buildIdPath = path.join(webDir, '.next', 'BUILD_ID')

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

const getApiEnvironment = async () => {
  const envFromExample = await readSimpleDotenv(apiEnvExampleFile)

  return {
    ...envFromExample,
    FLASK_APP: 'app.py',
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

export const ensureWebBuild = async () => {
  await ensureWebEnvLocal()

  if (process.env.E2E_FORCE_WEB_BUILD === '1') {
    await runCommandOrThrow({
      command: 'pnpm',
      args: ['run', 'build'],
      cwd: webDir,
    })
    return
  }

  try {
    await access(buildIdPath)
    console.log('Reusing existing web build artifact.')
  } catch {
    await runCommandOrThrow({
      command: 'pnpm',
      args: ['run', 'build'],
      cwd: webDir,
    })
  }
}

export const startWeb = async () => {
  await ensureWebBuild()

  await runForegroundProcess({
    command: 'pnpm',
    args: ['run', 'start'],
    cwd: webDir,
    env: {
      HOSTNAME: '127.0.0.1',
      PORT: '3000',
    },
  })
}

export const startApi = async () => {
  const env = await getApiEnvironment()

  await runCommandOrThrow({
    command: 'uv',
    args: ['run', '--project', '.', 'flask', 'upgrade-db'],
    cwd: apiDir,
    env,
  })

  await runForegroundProcess({
    command: 'uv',
    args: ['run', '--project', '.', 'flask', 'run', '--host', '127.0.0.1', '--port', '5001'],
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
  console.log('Usage: tsx ./scripts/setup.ts <reset|middleware-up|middleware-down|api|web>')
}

const main = async () => {
  const command = process.argv[2]

  switch (command) {
    case 'api':
      await startApi()
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
