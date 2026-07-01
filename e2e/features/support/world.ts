import type { IWorldOptions } from '@cucumber/cucumber'
import type { Browser, BrowserContext, ConsoleMessage, Download, Page } from '@playwright/test'
import type { AuthSessionMetadata } from '../../fixtures/auth'
import { setWorldConstructor, World } from '@cucumber/cucumber'
import { authStatePath, readAuthSessionMetadata } from '../../fixtures/auth'
import { baseURL, defaultLocale } from '../../test-env'

export type ScenarioCleanup = () => Promise<void> | void
export type CreatedAgentDriveFile = {
  agentId: string
  key: string
}
export type CreatedBuiltinToolCredential = {
  credentialId: string
  provider: string
}
export type AgentBuilderStableChatModel = {
  name: string
  provider: string
  type: string
}
export type AgentBuilderPreseededResource = {
  id: string
  kind: 'agent' | 'api-key' | 'dataset' | 'skill' | 'tool' | 'workflow'
  name: string
}

export class DifyWorld extends World {
  context: BrowserContext | undefined
  page: Page | undefined
  consoleErrors: string[] = []
  pageErrors: string[] = []
  scenarioStartedAt: number | undefined
  session: AuthSessionMetadata | undefined
  lastCreatedAppName: string | undefined
  lastCreatedAgentName: string | undefined
  lastCreatedAgentRole: string | undefined
  lastAgentServiceApiBaseURL: string | undefined
  lastGeneratedAgentApiKey: string | undefined
  lastAgentApiReferencePage: Page | undefined
  createdAppIds: string[] = []
  createdAgentIds: string[] = []
  createdDatasetIds: string[] = []
  createdAgentDriveFiles: CreatedAgentDriveFile[] = []
  createdBuiltinToolCredentials: CreatedBuiltinToolCredential[] = []
  agentBuilderBrokenChatModel: AgentBuilderStableChatModel | undefined
  agentBuilderStableChatModel: AgentBuilderStableChatModel | undefined
  agentBuilderPreseededResources: Record<string, AgentBuilderPreseededResource> = {}
  scenarioCleanups: ScenarioCleanup[] = []
  capturedDownloads: Download[] = []
  shareURL: string | undefined

  constructor(options: IWorldOptions) {
    super(options)
    this.resetScenarioState()
  }

  resetScenarioState() {
    this.consoleErrors = []
    this.pageErrors = []
    this.lastCreatedAppName = undefined
    this.lastCreatedAgentName = undefined
    this.lastCreatedAgentRole = undefined
    this.lastAgentServiceApiBaseURL = undefined
    this.lastGeneratedAgentApiKey = undefined
    this.lastAgentApiReferencePage = undefined
    this.createdAppIds = []
    this.createdAgentIds = []
    this.createdDatasetIds = []
    this.createdAgentDriveFiles = []
    this.createdBuiltinToolCredentials = []
    this.agentBuilderBrokenChatModel = undefined
    this.agentBuilderStableChatModel = undefined
    this.agentBuilderPreseededResources = {}
    this.scenarioCleanups = []
    this.capturedDownloads = []
    this.shareURL = undefined
  }

  async startSession(browser: Browser, authenticated: boolean) {
    this.resetScenarioState()
    this.context = await browser.newContext({
      baseURL,
      locale: defaultLocale,
      ...(authenticated ? { storageState: authStatePath } : {}),
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
    this.page.on('download', (dl) => {
      this.capturedDownloads.push(dl)
    })
  }

  async startAuthenticatedSession(browser: Browser) {
    await this.startSession(browser, true)
  }

  async startUnauthenticatedSession(browser: Browser) {
    await this.startSession(browser, false)
  }

  getPage() {
    if (!this.page) throw new Error('Playwright page has not been initialized for this scenario.')

    return this.page
  }

  async getAuthSession() {
    this.session ??= await readAuthSessionMetadata()
    return this.session
  }

  registerCleanup(cleanup: ScenarioCleanup) {
    this.scenarioCleanups.push(cleanup)
  }

  async runRegisteredCleanups() {
    const errors: string[] = []

    for (const cleanup of this.scenarioCleanups.toReversed()) {
      try {
        await cleanup()
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (errors.length > 0) this.attach(`Cleanup errors:\n${errors.join('\n')}`, 'text/plain')
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
