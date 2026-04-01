import { type IWorldOptions, World, setWorldConstructor } from '@cucumber/cucumber'
import type { Browser, BrowserContext, ConsoleMessage, Page } from '@playwright/test'
import {
  authStatePath,
  readAuthSessionMetadata,
  type AuthSessionMetadata,
} from '../../fixtures/auth'
import { baseURL, defaultLocale } from '../../test-env'

export class DifyWorld extends World {
  context: BrowserContext | undefined
  page: Page | undefined
  consoleErrors: string[] = []
  pageErrors: string[] = []
  scenarioStartedAt: number | undefined
  session: AuthSessionMetadata | undefined

  constructor(options: IWorldOptions) {
    super(options)
    this.resetScenarioState()
  }

  resetScenarioState() {
    this.consoleErrors = []
    this.pageErrors = []
  }

  async startAuthenticatedSession(browser: Browser) {
    this.resetScenarioState()
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
  }

  getPage() {
    if (!this.page) throw new Error('Playwright page has not been initialized for this scenario.')

    return this.page
  }

  async getAuthSession() {
    this.session ??= await readAuthSessionMetadata()
    return this.session
  }

  async closeSession() {
    await this.context?.close()
    this.context = undefined
    this.page = undefined
    this.session = undefined
    this.scenarioStartedAt = undefined
    this.resetScenarioState()
  }
}

setWorldConstructor(DifyWorld)
