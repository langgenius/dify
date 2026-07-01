import type { AgentAppDetailWithSite } from '@dify/contracts/api/console/agent/types.gen'
import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createE2EResourceName } from '../../../support/naming'

When('I create an Agent v2 test agent from the Agent Roster', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentName = createE2EResourceName('Agent', 'roster-ui')
  const agentRole = 'E2E roster-created assistant'
  const agentDescription = 'Created by Dify E2E through the Agent Roster UI.'

  await page.goto('/roster')
  await page.getByRole('button', { name: 'Create agent' }).click()

  const dialog = page.getByRole('dialog', { name: 'Create agent' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Name' }).fill(agentName)
  await dialog.getByRole('textbox', { name: 'Role' }).fill(agentRole)
  await dialog.getByRole('textbox', { name: 'Description' }).fill(agentDescription)

  const createResponsePromise = page.waitForResponse(response => (
    response.request().method() === 'POST'
    && new URL(response.url()).pathname.endsWith('/console/api/agent')
  ))

  await dialog.getByRole('button', { name: 'Create' }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.ok()).toBe(true)

  const createdAgent = await createResponse.json() as AgentAppDetailWithSite
  this.createdAgentIds.push(createdAgent.id)
  this.lastCreatedAgentName = createdAgent.name
  this.lastCreatedAgentRole = createdAgent.role ?? undefined
})

Then('the created Agent v2 should open in Configure', async function (this: DifyWorld) {
  const agentId = this.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  await expect(this.getPage()).toHaveURL(
    new RegExp(`/roster/agent/${agentId}/configure(?:\\?.*)?$`),
    { timeout: 30_000 },
  )
  await expect(this.getPage().getByRole('heading', { name: 'Configure' }))
    .toBeVisible({ timeout: 30_000 })
})
