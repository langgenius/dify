import type { ManagedProcess } from '../support/process'
import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { startLoggedProcess, stopManagedProcess, waitForUrl } from '../support/process'
import { startWebServer, stopWebServer } from '../support/web-server'
import { apiURL, baseURL, reuseExistingWebServer } from '../test-env'
import { e2eDir, isMainModule, runCommand } from './common'
import { resetState, startMiddleware, stopMiddleware } from './setup'
import './env-register'

type RunOptions = {
  forwardArgs: string[]
  full: boolean
  headed: boolean
}

const parseArgs = (argv: string[]): RunOptions => {
  let full = false
  let headed = false
  const forwardArgs: string[] = []

  for (const [index, arg] of argv.entries()) {
    if (arg === '--') {
      forwardArgs.push(...argv.slice(index + 1))
      return { forwardArgs, full, headed }
    }

    if (arg === '--full') {
      full = true
      continue
    }

    if (arg === '--headed') {
      headed = true
      continue
    }

    forwardArgs.push(arg)
  }

  return { forwardArgs, full, headed }
}

const hasCustomTags = (forwardArgs: string[]) =>
  forwardArgs.some((arg) => arg === '--tags' || arg.startsWith('--tags='))

const fullNonExternalTags =
  'not @skip and not @preview and not @external-model and not @external-tool'

const isTruthyEnv = (value: string | undefined) => value === '1' || value === 'true'

const shouldStartAgentBackend = () => {
  if (isTruthyEnv(process.env.E2E_START_AGENT_BACKEND)) return true

  if (process.env.E2E_AGENT_BACKEND_URL || process.env.AGENT_BACKEND_BASE_URL) return false

  return false
}

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

const main = async () => {
  const { forwardArgs, full, headed } = parseArgs(process.argv.slice(2))
  const startMiddlewareForRun = full
  const resetStateForRun = full
  const startAgentBackendForRun = shouldStartAgentBackend()

  if (resetStateForRun) await resetState()

  if (startMiddlewareForRun) await startMiddleware()

  const cucumberReportDir = path.join(e2eDir, 'cucumber-report')
  const logDir = path.join(e2eDir, '.logs')

  await rm(cucumberReportDir, { force: true, recursive: true })
  await mkdir(logDir, { recursive: true })

  const shellctlProcess = startAgentBackendForRun
    ? await startLoggedProcess({
        command: 'npx',
        args: ['tsx', './scripts/setup.ts', 'shellctl-sandbox'],
        cwd: e2eDir,
        label: 'shellctl sandbox',
        logFilePath: path.join(logDir, 'cucumber-shellctl-sandbox.log'),
      })
    : undefined

  const difyAgentProcess = startAgentBackendForRun
    ? await startLoggedProcess({
        command: 'npx',
        args: ['tsx', './scripts/setup.ts', 'agent-backend'],
        cwd: e2eDir,
        env: {
          E2E_START_AGENT_BACKEND: '1',
        },
        label: 'agent backend',
        logFilePath: path.join(logDir, 'cucumber-agent-backend.log'),
      })
    : undefined

  const apiProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './scripts/setup.ts', 'api'],
    cwd: e2eDir,
    env: startAgentBackendForRun
      ? {
          E2E_START_AGENT_BACKEND: '1',
        }
      : undefined,
    label: 'api server',
    logFilePath: path.join(logDir, 'cucumber-api.log'),
  })

  const celeryProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './scripts/setup.ts', 'celery'],
    cwd: e2eDir,
    label: 'celery worker',
    logFilePath: path.join(logDir, 'cucumber-celery.log'),
  })

  let cleanupPromise: Promise<void> | undefined
  const cleanup = async () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        await stopWebServer()
        await stopManagedProcess(celeryProcess)
        await stopManagedProcess(apiProcess)
        await stopManagedProcess(difyAgentProcess)
        await stopManagedProcess(shellctlProcess)

        if (startMiddlewareForRun) {
          try {
            await stopMiddleware()
          } catch {
            // Cleanup should continue even if middleware shutdown fails.
          }
        }
      })()
    }

    await cleanupPromise
  }

  const onTerminate = () => {
    void cleanup().finally(() => {
      process.exit(1)
    })
  }

  process.once('SIGINT', onTerminate)
  process.once('SIGTERM', onTerminate)

  try {
    if (shellctlProcess) {
      let waitingForShellctl = true
      try {
        const shellctlPort = process.env.E2E_SHELLCTL_PORT || '5004'
        await Promise.race([
          waitForUrl(`http://127.0.0.1:${shellctlPort}/healthz`, 180_000, 1_000),
          waitForUnexpectedProcessExit(shellctlProcess, () => !waitingForShellctl),
        ])
      } catch (error) {
        if (error instanceof Error && error.message.includes('exited before becoming ready'))
          throw error

        throw new Error(
          `Shellctl sandbox did not become ready. See ${shellctlProcess.logFilePath}.`,
        )
      } finally {
        waitingForShellctl = false
      }
    }

    if (difyAgentProcess) {
      let waitingForAgentBackend = true
      try {
        const agentBackendPort = process.env.E2E_AGENT_BACKEND_PORT || '5050'
        await Promise.race([
          waitForUrl(`http://127.0.0.1:${agentBackendPort}/openapi.json`, 180_000, 1_000),
          waitForUnexpectedProcessExit(difyAgentProcess, () => !waitingForAgentBackend),
        ])
      } catch (error) {
        if (error instanceof Error && error.message.includes('exited before becoming ready'))
          throw error

        throw new Error(`Agent backend did not become ready. See ${difyAgentProcess.logFilePath}.`)
      } finally {
        waitingForAgentBackend = false
      }
    }

    let waitingForApi = true
    try {
      await Promise.race([
        waitForUrl(`${apiURL}/health`, 180_000, 1_000),
        waitForUnexpectedProcessExit(apiProcess, () => !waitingForApi),
      ])
    } catch (error) {
      if (error instanceof Error && error.message.includes('exited before becoming ready'))
        throw error

      throw new Error(
        `API did not become ready at ${apiURL}/health. See ${apiProcess.logFilePath}.`,
      )
    } finally {
      waitingForApi = false
    }

    await startWebServer({
      baseURL,
      command: 'npx',
      args: ['tsx', './scripts/setup.ts', 'web'],
      cwd: e2eDir,
      logFilePath: path.join(logDir, 'cucumber-web.log'),
      reuseExistingServer: reuseExistingWebServer,
      timeoutMs: 300_000,
    })

    const cucumberEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CUCUMBER_HEADLESS: headed ? '0' : '1',
    }

    if (startMiddlewareForRun && !hasCustomTags(forwardArgs))
      cucumberEnv.E2E_CUCUMBER_TAGS = fullNonExternalTags

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

    process.exitCode = result.exitCode
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
