import { mkdir, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { waitForUrl, startLoggedProcess, stopManagedProcess } from '../support/process'
import { apiURL } from '../test-env'
import { e2eDir, ensureWebEnvLocal, isMainModule, runCommand } from './common'
import { resetState } from './reset-state'
import { startMiddleware } from './start-middleware'
import { stopMiddleware } from './stop-middleware'

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

const waitForWebReadyFile = async (readyFilePath: string, webManagerExited: () => boolean) => {
  const deadline = Date.now() + 300_000

  while (Date.now() < deadline) {
    try {
      const fileContent = await readFile(readyFilePath, 'utf8')
      const readyState = JSON.parse(fileContent) as {
        error?: string
      }

      if (readyState.error) throw new Error(readyState.error)

      return
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }

    if (webManagerExited())
      throw new Error('Web server manager exited before the web server became ready.')

    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }

  throw new Error('Web server did not become ready in time.')
}

const main = async () => {
  const { forwardArgs, full, headed } = parseArgs(process.argv.slice(2))
  const startMiddlewareForRun = full
  const resetStateForRun = full

  await ensureWebEnvLocal()

  if (resetStateForRun) await resetState()

  if (startMiddlewareForRun) await startMiddleware()

  const cucumberReportDir = path.join(e2eDir, 'cucumber-report')
  const logDir = path.join(e2eDir, '.logs')
  const webReadyFilePath = path.join(logDir, 'web-server.ready.json')

  await rm(cucumberReportDir, { force: true, recursive: true })
  await mkdir(logDir, { recursive: true })
  await rm(webReadyFilePath, { force: true })

  const apiProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './scripts/start-api.ts'],
    cwd: e2eDir,
    label: 'api server',
    logFilePath: path.join(logDir, 'cucumber-api.log'),
  })

  const webManagerProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './support/cli/start-web-server.ts'],
    cwd: e2eDir,
    env: {
      E2E_WEB_SERVER_LOG_PATH: path.join(logDir, 'cucumber-web.log'),
      E2E_WEB_SERVER_READY_FILE: webReadyFilePath,
    },
    label: 'web server manager',
    logFilePath: path.join(logDir, 'web-server-manager.log'),
  })

  let cleanupPromise: Promise<void> | undefined
  const cleanup = async () => {
    if (!cleanupPromise) {
      cleanupPromise = (async () => {
        await stopManagedProcess(webManagerProcess)
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

    await waitForWebReadyFile(
      webReadyFilePath,
      () => webManagerProcess.childProcess.exitCode !== null,
    )

    const cucumberEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CUCUMBER_HEADLESS: headed ? '0' : '1',
    }

    if (startMiddlewareForRun && !hasCustomTags(forwardArgs))
      cucumberEnv.E2E_CUCUMBER_TAGS = 'not @skip'
    else delete cucumberEnv.E2E_CUCUMBER_TAGS

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
