import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { startWebServer, stopWebServer } from '../support/web-server'
import { waitForUrl, startLoggedProcess, stopManagedProcess } from '../support/process'
import { apiURL, baseURL, reuseExistingWebServer } from '../test-env'
import { e2eDir, isMainModule, runCommand } from './common'
import { resetState, startMiddleware, stopMiddleware } from './setup'

type RunOptions = {
  forwardArgs: string[]
  full: boolean
  headed: boolean
}

const parseArgs = (argv: string[]): RunOptions => {
  let full = false
  let headed = false
  const forwardArgs: string[] = []

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]

    if (arg === '--') {
      forwardArgs.push(...argv.slice(index + 1))
      break
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

  return {
    forwardArgs,
    full,
    headed,
  }
}

const hasCustomTags = (forwardArgs: string[]) =>
  forwardArgs.some((arg) => arg === '--tags' || arg.startsWith('--tags='))

const main = async () => {
  const { forwardArgs, full, headed } = parseArgs(process.argv.slice(2))
  const startMiddlewareForRun = full
  const resetStateForRun = full

  if (resetStateForRun) await resetState()

  if (startMiddlewareForRun) await startMiddleware()

  const cucumberReportDir = path.join(e2eDir, 'cucumber-report')
  const logDir = path.join(e2eDir, '.logs')

  await rm(cucumberReportDir, { force: true, recursive: true })
  await mkdir(logDir, { recursive: true })

  const apiProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './scripts/setup.ts', 'api'],
    cwd: e2eDir,
    label: 'api server',
    logFilePath: path.join(logDir, 'cucumber-api.log'),
  })

  let cleanupPromise: Promise<void> | undefined
  const cleanup = async () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        await stopWebServer()
        await stopManagedProcess(apiProcess)

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
    try {
      await waitForUrl(`${apiURL}/health`, 180_000, 1_000)
    } catch {
      throw new Error(`API did not become ready at ${apiURL}/health.`)
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
      cucumberEnv.E2E_CUCUMBER_TAGS = 'not @skip'

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
