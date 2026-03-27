import { type IWorldOptions, World, setWorldConstructor } from '@cucumber/cucumber'
import type { Browser, BrowserContext, ConsoleMessage, Page, Response } from '@playwright/test'
import type { AuthSessionMetadata } from '../../fixtures/auth'
import { authStatePath } from '../../fixtures/auth'
import { baseURL, defaultLocale } from '../../test-env'

export type ScenarioArtifact = {
  kind: 'html' | 'screenshot'
  path: string
}

export class DifyWorld extends World {
  browser: Browser | undefined
  context: BrowserContext | undefined
  page: Page | undefined
  appName: string | undefined
  artifacts: ScenarioArtifact[] = []
  consoleErrors: string[] = []
  pageErrors: string[] = []
  lastResponse: Response | undefined
  scenarioStartedAt: number | undefined
  session: AuthSessionMetadata | undefined

  constructor(options: IWorldOptions) {
    super(options)
    this.resetScenarioState()
  }

  resetScenarioState() {
    this.artifacts = []
    this.consoleErrors = []
    this.pageErrors = []
    this.lastResponse = undefined
  }

  async startAuthenticatedSession(browser: Browser) {
    this.resetScenarioState()
    this.browser = browser
    this.context = await browser.newContext({
      baseURL,
      locale: defaultLocale,
      storageState: authStatePath,
    })
    this.context.setDefaultTimeout(30_000)
    this.page = await this.context.newPage()
    this.page.setDefaultTimeout(30_000)

    this.page.on('console', (message: ConsoleMessage) => {
      if (message.type() === 'error') this.consoleErrors.push(message.text())
    })
    this.page.on('pageerror', (error) => {
      this.pageErrors.push(error.message)
    })
    this.page.on('response', (response) => {
      this.lastResponse = response
    })
  }

  getPage() {
    if (!this.page) throw new Error('Playwright page has not been initialized for this scenario.')

    return this.page
  }

  async closeSession() {
    await this.context?.close()
    this.context = undefined
    this.page = undefined
    this.appName = undefined
    this.session = undefined
    this.scenarioStartedAt = undefined
    this.resetScenarioState()
  }
}

setWorldConstructor(DifyWorld)
