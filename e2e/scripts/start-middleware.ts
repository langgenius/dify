import { isPortReachable, waitForUrl } from '../support/process'
import {
  dockerDir,
  ensureFileExists,
  ensureLineInFile,
  isMainModule,
  isTcpPortReachable,
  middlewareComposeFile,
  middlewareEnvExampleFile,
  middlewareEnvFile,
  runCommand,
  runCommandOrThrow,
  waitForCondition,
} from './common'

const composeArgs = [
  'compose',
  '-f',
  middlewareComposeFile,
  '--profile',
  'postgresql',
  '--profile',
  'weaviate',
]

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

  console.log('Waiting for PostgreSQL and Redis health checks...')
  await waitForCondition({
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
  })

  console.log('Waiting for Weaviate readiness...')
  try {
    await waitForUrl('http://127.0.0.1:8080/v1/.well-known/ready', 120_000, 2_000)
  } catch (error) {
    await printComposeLogs(['weaviate'])
    throw error
  }

  console.log('Waiting for sandbox health...')
  try {
    await waitForUrl('http://127.0.0.1:8194/health', 120_000, 2_000)
  } catch (error) {
    await printComposeLogs(['sandbox', 'ssrf_proxy'])
    throw error
  }

  console.log('Waiting for plugin daemon port...')
  try {
    await waitForCondition({
      check: async () => isTcpPortReachable('127.0.0.1', 5002),
      description: 'plugin daemon port',
      intervalMs: 2_000,
      timeoutMs: 120_000,
    })
  } catch (error) {
    await printComposeLogs(['plugin_daemon'])
    throw error
  }

  const [weaviateReady, sandboxReady, pluginDaemonReady] = await Promise.all([
    isPortReachable('127.0.0.1', 8080),
    isPortReachable('127.0.0.1', 8194),
    isTcpPortReachable('127.0.0.1', 5002),
  ])

  if (!weaviateReady) {
    await printComposeLogs(['weaviate'])
    throw new Error('Weaviate did not become ready in time.')
  }

  if (!sandboxReady) {
    await printComposeLogs(['sandbox', 'ssrf_proxy'])
    throw new Error('Sandbox did not become ready in time.')
  }

  if (!pluginDaemonReady) {
    await printComposeLogs(['plugin_daemon'])
    throw new Error('Plugin daemon did not become reachable in time.')
  }

  console.log('Full middleware stack is ready.')
}

const main = async () => {
  await startMiddleware()
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
