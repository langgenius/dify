import type { FullConfig } from '@playwright/test'
import { chromium } from '@playwright/test'
import { ensureAuthenticatedState, resolveBaseURL } from './fixtures/auth'

const globalSetup = async (config: FullConfig) => {
  const browser = await chromium.launch()

  try {
    const configuredBaseURL = config.projects.find(
      (project) => typeof project.use.baseURL === 'string',
    )?.use.baseURL as string | undefined

    await ensureAuthenticatedState(browser, resolveBaseURL(configuredBaseURL))
  } finally {
    await browser.close()
  }
}

export default globalSetup
