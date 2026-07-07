import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure'
import { getAgentVersionDetail, getTestAgent } from '../../agent-v2/support/agent'
import { normalAgentPrompt } from '../../agent-v2/support/agent-soul'
import { expectAgentModelRequiredFeedback, getCurrentAgentId } from './configure-helpers'

When('I publish the Agent v2 draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
})

When('I try to publish the Agent v2 draft without a model', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
})

Then('Agent v2 publish should be blocked until a model is configured', async function (this: DifyWorld) {
  await expectAgentModelRequiredFeedback(this.getPage())
})

Then('the Agent v2 draft should remain unpublished', async function (this: DifyWorld) {
  await expect.poll(
    async () => (await getTestAgent(getCurrentAgentId(this))).active_config_is_published,
    { timeout: 30_000 },
  ).toBe(false)
})

Then('the Agent v2 configuration should be saved automatically', async function (this: DifyWorld) {
  await waitForAgentConfigureAutosaved(this.getPage())
})

Then('the Agent v2 draft should be published and up to date', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await expect(page.getByRole('button', { name: 'Published' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('status', { name: /^Up to date\./ })).toBeVisible()
  await expect(page.getByText('Up to date')).toBeVisible()
  await expect.poll(async () => (await getTestAgent(agentId)).active_config_is_published).toBe(true)
})

Then(
  'the Agent v2 publish action should be available for unpublished changes',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const agentId = getCurrentAgentId(this)

    await expect(page.getByRole('status', { name: /^(?:Draft|Unpublished changes)\./ }))
      .toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('button', { name: /^Publish(?: update)?$/ }))
      .toBeEnabled()
    await expect.poll(async () => (await getTestAgent(agentId)).active_config_is_published)
      .toBe(false)
  },
)

Then('the Agent v2 publish action should be unavailable while up to date', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('status', { name: /^Up to date\./ })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Published' })).toBeDisabled()
})

When('I open the Agent v2 version history', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByRole('button', { name: 'Open version history' }).click()
  await expect(page.getByRole('heading', { name: 'Versions' })).toBeVisible({ timeout: 30_000 })
})

When('I select Agent v2 published version {int}', async function (this: DifyWorld, versionNumber: number) {
  const page = this.getPage()
  const versionButton = page.getByRole('button', { name: new RegExp(`\\bVersion ${versionNumber}\\b`) })

  await expect(versionButton).toBeVisible({ timeout: 30_000 })
  await versionButton.click()
})

Then('the selected Agent v2 version should be displayed in view-only mode', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByText('View Only')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Restore' })).toBeEnabled()
})

When('I restore the selected Agent v2 version', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)
  const restoreResponse = page.waitForResponse(response =>
    response.request().method() === 'POST'
    && response.url().includes(`/console/api/agent/${agentId}/versions/`)
    && response.url().endsWith('/restore'),
  )

  await page.getByRole('button', { name: 'Restore' }).click()
  const response = await restoreResponse
  expect(response.ok()).toBe(true)
})

Then(
  'the active published Agent v2 version should still use the normal E2E prompt',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)

    await expect.poll(async () => (await getTestAgent(agentId)).active_config_is_published, {
      timeout: 30_000,
    }).toBe(false)

    const agent = await getTestAgent(agentId)
    const activeSnapshotId = agent?.active_config_snapshot_id
    if (!activeSnapshotId)
      throw new Error(`Agent v2 ${agentId} does not have an active published snapshot.`)

    const version = await getAgentVersionDetail(agentId, activeSnapshotId)

    expect(version.config_snapshot.prompt).toEqual({ system_prompt: normalAgentPrompt })
  },
)
