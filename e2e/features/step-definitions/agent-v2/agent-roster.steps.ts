import type { DifyWorld } from '../../support/world.ts'
import { Then, When } from '@cucumber/cucumber'
import { zPostAgentResponse } from '@dify/contracts/api/console/agent/zod.gen'
import { expect } from '@playwright/test'
import { createE2EResourceName } from '../../../support/naming.ts'

When('I create an Agent v2 test agent from the Agent Roster', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentName = createE2EResourceName('Agent', 'roster-ui')
  const agentRole = 'E2E roster-created assistant'
  const agentDescription = 'Created by Dify E2E through the Agent Roster UI.'

  await page.goto('/agents')
  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('menuitem', { name: 'Create from Blank' }).click()

  const dialog = page.getByRole('dialog', { name: 'Create agent' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox', { name: 'Name' }).fill(agentName)
  await dialog.getByRole('textbox', { name: /Role.*optional/ }).fill(agentRole)
  await dialog.getByRole('textbox', { name: /Description.*optional/ }).fill(agentDescription)

  const createResponsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/console/api/agent'),
  )

  await dialog.getByRole('button', { name: 'Create' }).click()
  const createResponse = await createResponsePromise
  expect(createResponse.ok()).toBe(true)

  const createdAgent = zPostAgentResponse.parse(await createResponse.json())
  this.createdAgentIds.push(createdAgent.id)
  this.lastCreatedAgentName = createdAgent.name
  this.lastCreatedAgentRole = createdAgent.role ?? undefined
})

Then('the created Agent v2 should open in Configure', async function (this: DifyWorld) {
  const agentId = this.createdAgentIds.at(-1)
  if (!agentId) throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  await expect(this.getPage()).toHaveURL(new RegExp(`/agents/${agentId}/configure(?:\\?.*)?$`), {
    timeout: 30_000,
  })
  await expect(this.getPage().getByRole('heading', { name: 'Configure' })).toBeVisible({
    timeout: 30_000,
  })
})

When('I delete the configured Agent v2 from the Agent Roster', async function (this: DifyWorld) {
  const id = this.createdAgentIds.at(-1)
  const name = this.lastCreatedAgentName
  if (!id || !name) throw new Error('Create a named Agent before deleting it.')
  const page = this.getPage()
  await page.goto('/agents')
  const card = page.getByRole('listitem', { name, exact: true })
  await expect(card).toBeVisible({ timeout: 30_000 })
  await card.hover()
  await card.getByLabel(`More actions for ${name}`).click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()

  const dialog = page.getByRole('alertdialog', { name: `Delete ${name}?`, exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('textbox').fill(name)
  const deletion = page.waitForResponse(
    (response) =>
      response.request().method() === 'DELETE' &&
      new URL(response.url()).pathname.endsWith(`/console/api/agent/${id}`),
  )
  await dialog.getByRole('button', { name: 'Confirm', exact: true }).click()
  expect((await deletion).status()).toBe(204)
  this.agentBuilder.lifecycle.deletedAgent = { id, name }
  this.createdAgentIds = this.createdAgentIds.filter((agentId) => agentId !== id)
  await expect(dialog).toBeHidden()
  await expect(card).toHaveCount(0)
})

Then(
  'the deleted Agent v2 should stay absent after refreshing the roster',
  async function (this: DifyWorld) {
    const deleted = this.agentBuilder.lifecycle.deletedAgent
    if (!deleted) throw new Error('Delete an Agent before checking the refreshed roster.')
    const page = this.getPage()
    await page.reload()
    await expect(page.getByRole('region', { name: 'Agents', exact: true })).toHaveAttribute(
      'aria-busy',
      'false',
    )
    await expect(page.getByRole('listitem', { name: deleted.name, exact: true })).toHaveCount(0)
    await expect(
      this.getConsoleClient().agent.byAgentId.get({ params: { agent_id: deleted.id } }),
    ).rejects.toMatchObject({ status: 404 })
  },
)
