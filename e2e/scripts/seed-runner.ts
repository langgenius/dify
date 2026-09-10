import { chromium } from '@playwright/test'
import { createAgentV2SeedTasks } from '../features/agent-v2/support/seed'
import { ensureAuthenticatedState } from '../fixtures/auth'
import { createStandaloneConsoleSession } from '../support/api/console-session'
import { runSeedTasks, writeSeedReport } from '../support/seed'
import { baseURL } from '../test-env'

export type SeedOptions = {
  allowBlocked: boolean
  dryRun: boolean
  pack: string
  profile: string
}

const getTasks = (pack: string, profile: string) => {
  if (pack === 'agent-v2') return createAgentV2SeedTasks(profile)

  throw new Error(`Unknown seed pack "${pack}".`)
}

const ensureAuth = async () => {
  const browser = await chromium.launch({ headless: true })
  try {
    await ensureAuthenticatedState(browser, baseURL)
  } finally {
    await browser.close()
  }
}

export const runSeed = async ({ allowBlocked, dryRun, pack, profile }: SeedOptions) => {
  console.warn(`[seed] bootstrapping auth state against ${baseURL}`)
  await ensureAuth()

  const consoleSession = await createStandaloneConsoleSession()
  try {
    const results = await runSeedTasks(getTasks(pack, profile), {
      consoleClient: consoleSession.client,
      dryRun,
      resources: new Map(),
    })
    const reportName = `${pack}-${profile}`
    const reportPath = await writeSeedReport(reportName, results)
    const blockedCount = results.filter((result) => result.status === 'blocked').length

    console.warn(`[seed] report ${reportPath}`)
    if (blockedCount > 0 && !allowBlocked) {
      throw new Error(
        `${blockedCount} seed task${blockedCount === 1 ? '' : 's'} blocked. Re-run with --allow-blocked only when partial readiness is intentional.`,
      )
    }
  } finally {
    await consoleSession.dispose()
  }
}
