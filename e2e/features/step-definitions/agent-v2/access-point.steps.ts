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

When('I switch to the Agent v2 Access Point section', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('link', { name: 'Access Point' }).click()
  await expect(page).toHaveURL(new RegExp(`/roster/agent/${agentId}/access(?:\\?.*)?$`))
  await expect(page.getByRole('region', { name: 'Access Point' })).toBeVisible()
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

When('I copy the Agent v2 Backend service API endpoint', async function (this: DifyWorld) {
  await this.getPage().getByLabel('Copy service API endpoint').click()
})

Then(
  'the Agent v2 Backend service API endpoint should show it was copied',
  async function (this: DifyWorld) {
    await expect(this.getPage().getByLabel('Copied')).toBeVisible()
  },
)

When('I open Agent v2 API key management', async function (this: DifyWorld) {
  await this.getPage()
    .getByRole('button', { name: /^API Key\b/ })
    .click()
})

Then('Agent v2 API keys should not expose a secret by default', async function (this: DifyWorld) {
  const page = this.getPage()
  const dialog = page.getByRole('dialog', { name: /API Secret key/i })

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Secret Key', { exact: true })).toBeVisible()
  await expect(dialog.getByText('CREATED', { exact: true })).toBeVisible()
  await expect(dialog.getByText('LAST USED', { exact: true })).toBeVisible()
  await expect(dialog.getByText('No data', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create new Secret key' })).toBeVisible()
  await expect(dialog.getByText(/^app-/)).not.toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Internal Server Error' })).not.toBeVisible()
})

When('I create a new Agent v2 API key', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('dialog', { name: /API Secret key/i })

  await dialog.getByRole('button', { name: 'Create new Secret key' }).click()
})

Then('I should see the newly generated Agent v2 API key once', async function (this: DifyWorld) {
  const generatedKeyDialog = this.getPage()
    .getByRole('dialog', { name: /API Secret key/i })
    .last()
  const generatedKey = generatedKeyDialog.getByText(/^app-/)

  await expect(generatedKeyDialog).toBeVisible()
  await expect(
    generatedKeyDialog.getByText('Keep this key in a secure and accessible place.'),
  ).toBeVisible()
  await expect(generatedKey).toBeVisible()
  await expect(generatedKeyDialog.getByLabel('Copy')).toBeVisible()

  this.lastGeneratedAgentApiKey = (await generatedKey.textContent())?.trim()
  if (!this.lastGeneratedAgentApiKey)
    throw new Error('Generated Agent v2 API key was empty.')
})

When('I close the newly generated Agent v2 API key', async function (this: DifyWorld) {
  const page = this.getPage()
  const generatedKeyDialog = page.getByRole('dialog', { name: /API Secret key/i }).last()

  await generatedKeyDialog.getByRole('button', { name: 'OK' }).click()
  await expect(page.getByText('Keep this key in a secure and accessible place.')).not.toBeVisible()
})

Then(
  'the Agent v2 API key list should not expose the full generated secret',
  async function (this: DifyWorld) {
    const fullSecret = this.lastGeneratedAgentApiKey
    if (!fullSecret)
      throw new Error('No generated Agent v2 API key found.')

    const apiKeyDialog = this.getPage().getByRole('dialog', { name: /API Secret key/i })

    await expect(apiKeyDialog).toBeVisible()
    await expect(apiKeyDialog.getByText(fullSecret, { exact: true })).not.toBeVisible()
    await expect(apiKeyDialog.getByText(/^app-/)).not.toBeVisible()
    await expect(apiKeyDialog.getByLabel('Copy')).toBeVisible()
  },
)

When('I close Agent v2 API key management', async function (this: DifyWorld) {
  const apiKeyDialog = this.getPage().getByRole('dialog', { name: /API Secret key/i })

  await apiKeyDialog.getByLabel('Close').click()
  await expect(apiKeyDialog).not.toBeVisible()
})

When('I open the Agent v2 API Reference', async function (this: DifyWorld) {
  const page = this.getPage()
  const apiReferenceLink = page.getByRole('link', { name: 'API Reference' })

  await expect(apiReferenceLink).toBeVisible()

  const [apiReferencePage] = await Promise.all([
    page.waitForEvent('popup'),
    apiReferenceLink.click(),
  ])

  this.lastAgentApiReferencePage = apiReferencePage
})

Then('the Agent v2 API Reference should open in a new tab', async function (this: DifyWorld) {
  const apiReferencePage = this.lastAgentApiReferencePage
  if (!apiReferencePage)
    throw new Error('No Agent v2 API Reference page was opened.')

  await expect(apiReferencePage).toHaveURL(/developing-with-apis/)
  await apiReferencePage.close()
  this.lastAgentApiReferencePage = undefined
})
