import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure.ts'
import {
  createAgentSoulConfigWithModel,
  normalAgentPrompt,
  normalAgentSoulConfig,
  updatedAgentSoulConfig,
} from '../../agent-v2/support/agent-soul.ts'
import {
  createTestAgent,
  getAgentConfigurePath,
  publishAgentWithPublishableDraft,
  saveAgentComposerDraft,
} from '../../agent-v2/support/agent.ts'
import { getCurrentAgentId } from './configure-helpers.ts'

Given('an Agent v2 has original and updated published prompts', async function (this: DifyWorld) {
  const stableModel = this.agentBuilder.fixtures.stableModel
  if (!stableModel)
    throw new Error('Create published Agent v2 versions after stable model fixture setup.')

  const client = this.getConsoleClient()
  const agent = await createTestAgent(client)
  this.createdAgentIds.push(agent.id)
  await saveAgentComposerDraft(
    client,
    agent.id,
    createAgentSoulConfigWithModel(normalAgentSoulConfig, stableModel),
  )
  await publishAgentWithPublishableDraft(client, agent.id, 'E2E original prompt')
  await saveAgentComposerDraft(
    client,
    agent.id,
    createAgentSoulConfigWithModel(updatedAgentSoulConfig, stableModel),
  )
  await publishAgentWithPublishableDraft(client, agent.id, 'E2E updated prompt')
})

Given(
  'the Agent v2 draft has unpublished updated prompt changes',
  async function (this: DifyWorld) {
    const stableModel = this.agentBuilder.fixtures.stableModel
    if (!stableModel) throw new Error('Update the Agent v2 draft after stable model fixture setup.')

    await saveAgentComposerDraft(
      this.getConsoleClient(),
      getCurrentAgentId(this),
      createAgentSoulConfigWithModel(updatedAgentSoulConfig, stableModel),
    )
  },
)

When('I publish the Agent v2 draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
})

Then('the Agent v2 configuration should be saved automatically', async function (this: DifyWorld) {
  await waitForAgentConfigureAutosaved(this.getPage())
})

Then('the Agent v2 first publication should succeed', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(
    page.getByRole('paragraph').filter({ hasText: /^Published successfully$/ }),
  ).toBeVisible({ timeout: 30_000 })
})

Then('the Agent v2 update publication should succeed', async function (this: DifyWorld) {
  await expect(
    this.getPage()
      .getByRole('paragraph')
      .filter({ hasText: /^Changes published$/ }),
  ).toBeVisible({ timeout: 30_000 })
})

When(
  'I follow the access methods link in the Agent v2 publish guidance',
  async function (this: DifyWorld) {
    const link = this.getPage().getByRole('link', { name: 'View all access methods' })

    await expect(link).toBeVisible({ timeout: 30_000 })
    await link.click()
  },
)

Then('the Agent v2 Access Point should open', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page).toHaveURL(new RegExp(`/agents/${getCurrentAgentId(this)}/access(?:\\?.*)?$`))
  await expect(page.getByRole('region', { name: 'Access Point' })).toBeVisible()
})

When(
  'I follow the Web app link in the Agent v2 publish guidance',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const link = page.getByRole('link', { name: 'Open Web App' })

    await expect(link).toBeVisible({ timeout: 30_000 })
    const href = await link.getAttribute('href')
    if (!href) throw new Error('Agent v2 publish guidance Web app link has no destination.')

    const [webAppPage] = await Promise.all([page.waitForEvent('popup'), link.click()])
    this.agentBuilder.accessPoint.webAppURL = href
    this.agentBuilder.accessPoint.webAppPage = webAppPage
  },
)

Then('the Agent v2 Publish update action should be available', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('status', { name: /^Unpublished changes\./ })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByRole('button', { name: 'Publish update' })).toBeEnabled()
})

When(
  'I view the original Agent v2 published version in version history',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await page.goto(getAgentConfigurePath(getCurrentAgentId(this)))
    await page.getByRole('button', { name: 'Open version history' }).click()
    await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible({ timeout: 30_000 })
    const versionButton = page.getByRole('button', { name: /^E2E original prompt\b/ })

    await expect(versionButton).toBeVisible({ timeout: 30_000 })
    await versionButton.click()
  },
)

Then('the original Agent v2 version should be view-only', async function (this: DifyWorld) {
  const page = this.getPage()
  const promptEditor = page
    .getByRole('region', { name: 'Prompt' })
    .getByRole('textbox', { name: 'Prompt' })

  await expect(page.getByText('View Only')).toBeVisible({ timeout: 30_000 })
  await expect(promptEditor).toContainText(normalAgentPrompt)
  await expect(promptEditor).not.toBeEditable()
  await expect(page.getByRole('button', { name: 'Restore' })).toBeEnabled()
})

When('I restore the selected Agent v2 version', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('button', { name: 'Restore', exact: true }).click()
  const confirmDialog = page.getByRole('alertdialog', { name: /^Restore / })
  await expect(confirmDialog).toBeVisible()

  const restoreResponse = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url().includes(`/console/api/agent/${agentId}/versions/`) &&
      response.url().endsWith('/restore'),
  )

  await confirmDialog.getByRole('button', { name: 'Restore', exact: true }).click()
  const response = await restoreResponse
  expect(response.ok()).toBe(true)
})

Then(
  'the original Agent v2 configuration should be an unpublished draft',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const promptEditor = page
      .getByRole('region', { name: 'Prompt' })
      .getByRole('textbox', { name: 'Prompt' })

    await expect(promptEditor).toContainText(normalAgentPrompt, { timeout: 30_000 })
    await expect(promptEditor).toBeEditable()
    await expect(page.getByRole('status', { name: /^Unpublished changes\./ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Publish update' })).toBeEnabled()
  },
)
