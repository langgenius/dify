import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentAccessPath, setAgentApiAccess } from '../../../support/agent'

const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

Given(
  'Agent v2 Backend service API access has been enabled via API',
  async function (this: DifyWorld) {
    const apiAccess = await setAgentApiAccess(getCurrentAgentId(this), true)

    this.lastAgentServiceApiBaseURL = apiAccess.service_api_base_url
  },
)

When('I open the Agent v2 Access Point page', async function (this: DifyWorld) {
  await this.getPage().goto(getAgentAccessPath(getCurrentAgentId(this)))
})

Then('I should see the Agent v2 Access Point overview', async function (this: DifyWorld) {
  const page = this.getPage()
  const accessRegion = page.getByRole('region', { name: 'Access Point' })

  await expect(accessRegion).toBeVisible({ timeout: 30_000 })
  await expect(accessRegion.getByRole('heading', { name: 'Access Point' })).toBeVisible()
  await expect(accessRegion.getByRole('heading', { name: 'Web app' })).toBeVisible()
  await expect(accessRegion.getByRole('heading', { name: 'Backend service API' })).toBeVisible()
  await expect(accessRegion.getByRole('heading', { name: 'Workflow access' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Name' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Version' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Nodes' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Last updated' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
  await expect(accessRegion.getByText('No workflow references yet.')).toBeVisible()
})

Then('I should see the Agent v2 Backend service API endpoint', async function (this: DifyWorld) {
  const page = this.getPage()

  if (!this.lastAgentServiceApiBaseURL)
    throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')

  await expect(page.getByRole('heading', { name: 'Backend service API' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Service API Endpoint')).toBeVisible()
  await expect(page.getByText(this.lastAgentServiceApiBaseURL)).toBeVisible()
  await expect(page.getByLabel('Copy service API endpoint')).toBeEnabled()
})

Then(
  'I should be able to open Agent v2 API key management without exposing a secret by default',
  async function (this: DifyWorld) {
    const page = this.getPage()

    await page.getByRole('button', { name: /^API Key\b/ }).click()
    const dialog = page.getByRole('dialog', { name: /API Secret key/i })

    await expect(dialog).toBeVisible()
    await expect(dialog.getByText('Secret Key', { exact: true })).toBeVisible()
    await expect(dialog.getByText('CREATED', { exact: true })).toBeVisible()
    await expect(dialog.getByText('LAST USED', { exact: true })).toBeVisible()
    await expect(dialog.getByText('No data', { exact: true })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Create new Secret key' })).toBeVisible()
    await expect(dialog.getByText(/^app-/)).not.toBeVisible()
    await expect(page.getByRole('dialog', { name: 'Internal Server Error' })).not.toBeVisible()
  },
)

Then('I should see the Agent v2 API Reference entry', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('link', { name: 'API Reference' })).toBeVisible()
})
