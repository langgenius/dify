import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { waitForAgentsConsole } from '../../../support/agents'
import { waitForAppsConsole } from '../../../support/apps'
import { waitForConsoleHome } from '../../../support/home'
import { waitForModelProviderIntegrations } from '../../../support/integrations'
import { waitForKnowledgeConsole } from '../../../support/knowledge'

type AccessibilityPageConfig = {
  path: string
  waitUntilReady: (page: Page) => Promise<void>
}

const accessibilityPages = {
  Agents: { path: '/agents', waitUntilReady: waitForAgentsConsole },
  Home: { path: '/', waitUntilReady: waitForConsoleHome },
  Integrations: {
    path: '/integrations/model-provider',
    waitUntilReady: waitForModelProviderIntegrations,
  },
  Knowledge: { path: '/datasets', waitUntilReady: waitForKnowledgeConsole },
  Studio: { path: '/apps', waitUntilReady: waitForAppsConsole },
} satisfies Record<string, AccessibilityPageConfig>

const getAccessibilityPage = (pageName: string): AccessibilityPageConfig => {
  const config = accessibilityPages[pageName as keyof typeof accessibilityPages]
  if (!config)
    throw new Error(
      `Unknown accessibility page "${pageName}". Expected one of: ${Object.keys(accessibilityPages).join(', ')}.`,
    )

  return config
}

When('I open the {string} main page', async function (this: DifyWorld, pageName: string) {
  await this.getPage().goto(getAccessibilityPage(pageName).path)
})

Then('I should be on the {string} main page', async function (this: DifyWorld, pageName: string) {
  await getAccessibilityPage(pageName).waitUntilReady(this.getPage())
})
