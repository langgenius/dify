import type { Page } from '@playwright/test'
import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentComposerDraft } from '../../agent-v2/support/agent'
import { agentBuilderExpectedTokens } from '../../agent-v2/support/agent-builder-resources'
import { skipBlockedPrecondition } from '../../agent-v2/support/preflight/common'
import {
  getCurrentAgentId,
  getDialog,
  getWebAppCard,
} from './access-point-helpers'

const WEB_APP_RUNTIME_RESPONSE_STEP_TIMEOUT_MS = 180_000

const getWebAppMessageInput = (webAppPage: Page) =>
  webAppPage.getByPlaceholder(/^Talk to /).last()

Then('I should see the Agent v2 Web app access URL', async function (this: DifyWorld) {
  const webAppCard = getWebAppCard(this)

  await expect(webAppCard.getByRole('heading', { name: 'Web app' })).toBeVisible()
  await expect(webAppCard.getByText('Access URL')).toBeVisible()
  await expect(webAppCard.getByLabel('Copy access URL')).toBeEnabled()
  await expect(webAppCard.getByRole('link', { name: 'Launch' })).toBeVisible()
})

Then(
  'I record the current Agent v2 orchestration draft',
  async function (this: DifyWorld) {
    const draft = await getAgentComposerDraft(getCurrentAgentId(this))

    this.agentBuilder.accessPoint.composerDraftSnapshot = JSON.stringify(draft.agent_soul ?? {})
  },
)

When('I copy the Agent v2 Web app access URL', async function (this: DifyWorld) {
  await getWebAppCard(this).getByLabel('Copy access URL').click()
})

Then('the Agent v2 Web app access URL should show it was copied', async function (this: DifyWorld) {
  await expect(this.getPage().getByLabel('Copied')).toBeVisible()
})

When('I launch the Agent v2 Web app', async function (this: DifyWorld) {
  const launchLink = getWebAppCard(this).getByRole('link', { name: 'Launch' })
  const href = await launchLink.getAttribute('href')
  if (!href)
    throw new Error('Agent v2 Web app Launch link does not expose an href.')

  const [webAppPage] = await Promise.all([
    this.getPage().waitForEvent('popup'),
    launchLink.click(),
  ])

  this.agentBuilder.accessPoint.webAppURL = href
  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

When('I open the Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

When('I send an E2E message in the Agent v2 Web app', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  const messageInput = getWebAppMessageInput(webAppPage)
  await expect(messageInput).toBeEditable({ timeout: 30_000 })
  await messageInput.fill('Please reply with the test success marker.')
  await messageInput.press('Enter')
})

Then('the Agent v2 Web app should open in a new tab', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppPage || !webAppURL)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage).toHaveURL(webAppURL)
  await expect(getWebAppMessageInput(webAppPage)).toBeEditable({ timeout: 30_000 })
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
  this.agentBuilder.accessPoint.webAppURL = undefined
})

Then(
  'the Agent v2 Web app response should include the updated E2E marker',
  { timeout: WEB_APP_RUNTIME_RESPONSE_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
    const webAppPage = this.agentBuilder.accessPoint.webAppPage
    if (!webAppPage)
      throw new Error('No Agent v2 Web app page was opened.')

    await expect(webAppPage.getByText(agentBuilderExpectedTokens.updatedAgentReply))
      .toBeVisible({ timeout: 120_000 })
  },
)

Then(
  'the Agent v2 Web app response should include the normal E2E marker',
  { timeout: WEB_APP_RUNTIME_RESPONSE_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
    const webAppPage = this.agentBuilder.accessPoint.webAppPage
    if (!webAppPage)
      throw new Error('No Agent v2 Web app page was opened.')

    await expect(webAppPage.getByText(agentBuilderExpectedTokens.agentReply))
      .toBeVisible({ timeout: 120_000 })
  },
)

Then(
  'the Agent v2 Web app response should not include the updated E2E marker',
  async function (this: DifyWorld) {
    const webAppPage = this.agentBuilder.accessPoint.webAppPage
    if (!webAppPage)
      throw new Error('No Agent v2 Web app page was opened.')

    await expect(webAppPage.getByText(agentBuilderExpectedTokens.updatedAgentReply))
      .not
      .toBeVisible()
  },
)

When('I close the Agent v2 Web app', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
})

When('I open Agent v2 Embedded configuration', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Embedded' }).click()
})

Then('I should see the Agent v2 Embedded configuration dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Embed on website')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Embed on website')).toBeVisible()
  await expect(dialog.getByText(/iframe|script/i)).toBeVisible()
})

When('I open Agent v2 Web app customization', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Custom Frontend' }).click()
})

Then('I should see the Agent v2 Web app customization dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Custom Frontend')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Custom Frontend')).toBeVisible()
  await expect(dialog.getByText(/NEXT_PUBLIC_APP_ID|NEXT_PUBLIC_API_URL/)).toBeVisible()
})

When('I open Agent v2 Web app settings', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Branding' }).click()
})

Then('I should see the Agent v2 Web app settings dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Branding')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('heading', { name: 'Branding' })).toBeVisible()
  await expect(dialog.getByText('web app Name')).toBeVisible()
  await expect(dialog.getByText('web app Description')).toBeVisible()
})

Then(
  'the current Agent v2 orchestration draft should be unchanged',
  async function (this: DifyWorld) {
    const snapshot = this.agentBuilder.accessPoint.composerDraftSnapshot
    if (!snapshot)
      throw new Error('No Agent v2 orchestration draft snapshot was recorded.')

    const draft = await getAgentComposerDraft(getCurrentAgentId(this))

    expect(JSON.stringify(draft.agent_soul ?? {})).toBe(snapshot)
  },
)

Given(
  'Agent v2 disabled Web app public unavailable state is available',
  async function (this: DifyWorld) {
    return skipBlockedPrecondition(
      this,
      'Disabled Agent v2 Web app public URL does not expose a stable user-visible unavailable state; the current route redirects to Web app sign-in.',
      {
        owner: 'product',
        remediation: 'Define and implement the disabled public Web app UX before enabling this scenario.',
      },
    )
  },
)

When('I open the disabled Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

Then('the disabled Agent v2 Web app should show an unavailable state', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage.getByText(/app is unavailable|site is disabled/i)).toBeVisible({
    timeout: 30_000,
  })
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
})

When('I open the restored Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

Then('the restored Agent v2 Web app should not show an unavailable state', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage.getByText(/app is unavailable|site is disabled/i)).not.toBeVisible()
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
})
