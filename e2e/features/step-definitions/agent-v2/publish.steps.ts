import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentVersionDetail, getTestAgent, normalAgentPrompt } from '../../../support/agent'
import { waitForAgentConfigureAutosaved } from '../../../support/agent-configure'
import { getCurrentAgentId } from './configure-helpers'

When('I publish the Agent v2 draft', async function (this: DifyWorld) {
  const page = this.getPage()
  const publishButton = page.getByRole('button', { name: /^Publish(?: update)?$/ })

  await expect(publishButton).toBeEnabled({ timeout: 30_000 })
  await publishButton.click()
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
