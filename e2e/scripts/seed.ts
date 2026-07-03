import type { ManagedProcess } from '../support/process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'
import { createAgentV2SeedTasks } from '../features/agent-v2/support/seed'
import { ensureAuthenticatedState } from '../fixtures/auth'
import { startLoggedProcess, stopManagedProcess, waitForUrl } from '../support/process'
import { runSeedTasks, writeSeedReport } from '../support/seed'
import { startWebServer, stopWebServer } from '../support/web-server'
import { apiURL, baseURL, reuseExistingWebServer } from '../test-env'
import { e2eDir, isMainModule } from './common'
import './env-register'

type SeedOptions = {
  allowBlocked: boolean
  dryRun: boolean
  pack: string
  profile: string
}

const parseArgs = (argv: string[]): SeedOptions => {
  const options: SeedOptions = {
    allowBlocked: false,
    dryRun: false,
    pack: 'agent-v2',
    profile: 'full',
  }

  for (const [index, arg] of argv.entries()) {
    if (arg === '--pack') {
      options.pack = argv[index + 1] || options.pack
      continue
    }
    if (arg.startsWith('--pack=')) {
      options.pack = arg.slice('--pack='.length)
      continue
    }
    if (arg === '--dry-run')
      options.dryRun = true
    if (arg === '--allow-blocked')
      options.allowBlocked = true
    if (arg === '--profile') {
      options.profile = argv[index + 1] || options.profile
      continue
    }
    if (arg.startsWith('--profile=')) {
      options.profile = arg.slice('--profile='.length)
      continue
    }
  }

  return options
}

const getTasks = (pack: string, profile: string) => {
  if (pack === 'agent-v2')
    return createAgentV2SeedTasks(profile)

  throw new Error(`Unknown seed pack "${pack}".`)
}

const ensureAuth = async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    await ensureAuthenticatedState(browser, baseURL)
  }
  finally {
    await browser.close()
  }
}

const startApiProcess = async (logDir: string) => {
  try {
    await waitForUrl(`${apiURL}/health`, 1_000, 250, 1_000)
    return undefined
  }
  catch {
    // Start a local API process below.
  }

  const apiProcess = await startLoggedProcess({
    command: 'npx',
    args: ['tsx', './scripts/setup.ts', 'api'],
    cwd: e2eDir,
    label: 'api server',
    logFilePath: path.join(logDir, 'seed-api.log'),
  })

  try {
    await waitForUrl(`${apiURL}/health`, 180_000, 1_000)
    return apiProcess
  }
  catch (error) {
    await stopManagedProcess(apiProcess)
    throw error
  }
}

const startCeleryProcess = async (logDir: string) =>
  startLoggedProcess({
    command: 'npx',
    args: [
      'tsx',
      './scripts/setup.ts',
      'celery',
      '--queues',
      'dataset,priority_dataset,workflow_based_app_execution',
    ],
    cwd: e2eDir,
    label: 'celery worker',
    logFilePath: path.join(logDir, 'seed-celery.log'),
  })

const main = async () => {
  const options = parseArgs(process.argv.slice(2))
  const logDir = path.join(e2eDir, '.logs')
  let apiProcess: ManagedProcess | undefined
  let celeryProcess: ManagedProcess | undefined

  await mkdir(logDir, { recursive: true })

  try {
    apiProcess = await startApiProcess(logDir)
    celeryProcess = await startCeleryProcess(logDir)
    await startWebServer({
      baseURL,
      command: 'npx',
      args: ['tsx', './scripts/setup.ts', 'web'],
      cwd: e2eDir,
      logFilePath: path.join(logDir, 'seed-web.log'),
      reuseExistingServer: reuseExistingWebServer,
      timeoutMs: 300_000,
    })

    console.warn(`[seed] bootstrapping auth state against ${baseURL}`)
    await ensureAuth()

    const results = await runSeedTasks(getTasks(options.pack, options.profile), {
      dryRun: options.dryRun,
      resources: new Map(),
    })
    const reportName = options.profile === 'full'
      ? options.pack
      : `${options.pack}-${options.profile}`
    const reportPath = await writeSeedReport(reportName, results)
    const blockedCount = results.filter(result => result.status === 'blocked').length

    console.warn(`[seed] report ${reportPath}`)
    if (blockedCount > 0 && !options.allowBlocked) {
      throw new Error(
        `${blockedCount} seed task${blockedCount === 1 ? '' : 's'} blocked. Re-run with --allow-blocked only when partial readiness is intentional.`,
      )
    }
  }
  finally {
    await stopWebServer()
    await stopManagedProcess(celeryProcess)
    await stopManagedProcess(apiProcess)
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
