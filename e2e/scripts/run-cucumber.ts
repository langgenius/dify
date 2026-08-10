import type { ManagedProcess } from '../support/process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { runCleanupTasks } from '../support/cleanup'
import { assertCucumberScenariosStarted } from '../support/cucumber-messages'
import { startLoggedProcess, stopManagedProcess, waitForUrl } from '../support/process'
import { startWebServer, stopWebServer } from '../support/web-server'
import { apiURL, baseURL, reuseExistingWebServer } from '../test-env'
import { e2eDir, isMainModule, runCommand } from './common'
import { parseRunOptions, shouldStartManagedAgentBackend } from './run-options'
import { runSeed } from './seed-runner'
import { resetState, startMiddleware, stopMiddleware } from './setup'
import './env-register'

const hasCustomTags = (forwardArgs: string[]) =>
  forwardArgs.some((arg) => arg === '--tags' || arg.startsWith('--tags='))

const fullNonExternalTags =
  'not @axe and not @prepared and not @external-model and not @external-tool'
const seedCeleryQueues = 'dataset,priority_dataset,workflow_based_app_execution'

const readLogTail = async (logFilePath: string) => {
  const content = await readFile(logFilePath, 'utf8').catch(() => '')

  return content.trim().split(/\r?\n/).slice(-20).join('\n')
}

const waitForUnexpectedProcessExit = async (
  managedProcess: ManagedProcess,
  shouldIgnoreExit: () => boolean,
) => {
  const { childProcess, label, logFilePath } = managedProcess

  await new Promise<void>((resolve) => {
    if (childProcess.exitCode !== null) {
      resolve()
      return
    }

    childProcess.once('exit', () => resolve())
  })

  if (shouldIgnoreExit()) return

  const logTail = await readLogTail(logFilePath)
  const logTailMessage = logTail ? `\n\nLast ${label} log lines:\n${logTail}` : ''

  throw new Error(`${label} exited before becoming ready. See ${logFilePath}.${logTailMessage}`)
}

const waitForManagedProcess = async ({
  errorMessage,
  managedProcess,
  url,
}: {
  errorMessage: string
  managedProcess: ManagedProcess
  url: string
}) => {
  let waiting = true
  try {
    await Promise.race([
      waitForUrl(url, 180_000, 1_000),
      waitForUnexpectedProcessExit(managedProcess, () => !waiting),
    ])
  } catch (error) {
    if (error instanceof Error && error.message.includes('exited before becoming ready'))
      throw error

    throw new Error(`${errorMessage} See ${managedProcess.logFilePath}.`)
  } finally {
    waiting = false
  }
}

const main = async () => {
  const { forwardArgs, full, headed, seed, seedOnly } = parseRunOptions(process.argv.slice(2))
  const startAgentBackendForRun = shouldStartManagedAgentBackend()
  const cucumberReportDir = path.join(e2eDir, 'cucumber-report')
  const logDir = path.join(e2eDir, '.logs')
  let apiProcess: ManagedProcess | undefined
  let celeryProcess: ManagedProcess | undefined
  let difyAgentProcess: ManagedProcess | undefined
  let middlewareStarted = false
  let shellctlProcess: ManagedProcess | undefined

  let cleanupPromise: Promise<void> | undefined
  const cleanup = async () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        const cleanupErrors = await runCleanupTasks([
          { label: 'Stop web server', run: stopWebServer },
          { label: 'Stop celery worker', run: () => stopManagedProcess(celeryProcess) },
          { label: 'Stop API server', run: () => stopManagedProcess(apiProcess) },
          { label: 'Stop agent backend', run: () => stopManagedProcess(difyAgentProcess) },
          { label: 'Stop shellctl sandbox', run: () => stopManagedProcess(shellctlProcess) },
          ...(middlewareStarted ? [{ label: 'Stop middleware', run: stopMiddleware }] : []),
        ])

        if (cleanupErrors.length > 0)
          throw new Error(`E2E teardown errors:\n${cleanupErrors.join('\n')}`)
      })()
    }

    await cleanupPromise
  }

  const onTerminate = () => {
    void cleanup()
      .catch((error) => {
        console.error(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        process.exit(1)
      })
  }

  process.once('SIGINT', onTerminate)
  process.once('SIGTERM', onTerminate)

  try {
    if (full) await resetState()

    if (full) {
      middlewareStarted = true
      await startMiddleware()
    }

    if (!seedOnly) await rm(cucumberReportDir, { force: true, recursive: true })
    await mkdir(logDir, { recursive: true })

    if (startAgentBackendForRun) {
      shellctlProcess = await startLoggedProcess({
        command: 'npx',
        args: ['tsx', './scripts/setup.ts', 'shellctl-sandbox'],
        cwd: e2eDir,
        label: 'shellctl sandbox',
        logFilePath: path.join(logDir, 'cucumber-shellctl-sandbox.log'),
      })
      const shellctlPort = process.env.E2E_SHELLCTL_PORT || '5004'
      await waitForManagedProcess({
        errorMessage: 'Shellctl sandbox did not become ready.',
        managedProcess: shellctlProcess,
        url: `http://127.0.0.1:${shellctlPort}/healthz`,
      })

      difyAgentProcess = await startLoggedProcess({
        command: 'npx',
        args: ['tsx', './scripts/setup.ts', 'agent-backend'],
        cwd: e2eDir,
        env: { E2E_START_AGENT_BACKEND: '1' },
        label: 'agent backend',
        logFilePath: path.join(logDir, 'cucumber-agent-backend.log'),
      })
      const agentBackendPort = process.env.E2E_AGENT_BACKEND_PORT || '5050'
      await waitForManagedProcess({
        errorMessage: 'Agent backend did not become ready.',
        managedProcess: difyAgentProcess,
        url: `http://127.0.0.1:${agentBackendPort}/openapi.json`,
      })
    }

    apiProcess = await startLoggedProcess({
      command: 'npx',
      args: ['tsx', './scripts/setup.ts', 'api'],
      cwd: e2eDir,
      env: startAgentBackendForRun ? { E2E_START_AGENT_BACKEND: '1' } : undefined,
      label: 'api server',
      logFilePath: path.join(logDir, 'cucumber-api.log'),
    })
    await waitForManagedProcess({
      errorMessage: `API did not become ready at ${apiURL}/health.`,
      managedProcess: apiProcess,
      url: `${apiURL}/health`,
    })

    celeryProcess = await startLoggedProcess({
      command: 'npx',
      args: [
        'tsx',
        './scripts/setup.ts',
        'celery',
        ...(seed ? ['--queues', seedCeleryQueues] : []),
      ],
      cwd: e2eDir,
      label: 'celery worker',
      logFilePath: path.join(logDir, 'cucumber-celery.log'),
    })

    await startWebServer({
      baseURL,
      command: 'npx',
      args: ['tsx', './scripts/setup.ts', 'web'],
      cwd: e2eDir,
      logFilePath: path.join(logDir, 'cucumber-web.log'),
      reuseExistingServer: reuseExistingWebServer,
      timeoutMs: 300_000,
    })

    if (seed) await runSeed(seed)

    if (!seedOnly) {
      const cucumberEnv: NodeJS.ProcessEnv = {
        ...process.env,
        CUCUMBER_HEADLESS: headed ? '0' : '1',
      }

      if (full && !hasCustomTags(forwardArgs)) cucumberEnv.E2E_CUCUMBER_TAGS = fullNonExternalTags

      const result = await runCommand({
        command: 'npx',
        args: [
          'tsx',
          './node_modules/@cucumber/cucumber/bin/cucumber.js',
          '--config',
          './cucumber.config.ts',
          ...forwardArgs,
        ],
        cwd: e2eDir,
        env: cucumberEnv,
      })

      if (result.exitCode === 0) {
        const messages = await readFile(path.join(cucumberReportDir, 'report.ndjson'), 'utf8')
        assertCucumberScenariosStarted(messages)
      }

      process.exitCode = result.exitCode
    }
  } finally {
    process.off('SIGINT', onTerminate)
    process.off('SIGTERM', onTerminate)
    await cleanup()
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
