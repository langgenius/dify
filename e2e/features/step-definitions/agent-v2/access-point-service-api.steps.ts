import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createAgentApiKey,
  publishAgent,
  sendAgentServiceApiChatMessage,
  setAgentApiAccess,
} from '../../agent-v2/support/agent'
import { agentBuilderExpectedTokens } from '../../agent-v2/support/agent-builder-resources'
import { getCurrentAgentId, getServiceApiCard } from './access-point-helpers'

Given(
  'Agent v2 Backend service API access has been enabled via API',
  async function (this: DifyWorld) {
    const apiAccess = await setAgentApiAccess(getCurrentAgentId(this), true)

    this.agentBuilder.accessPoint.serviceApiBaseURL = apiAccess.service_api_base_url
  },
)

Given('the Agent v2 draft has been published via API', async function (this: DifyWorld) {
  await publishAgent(getCurrentAgentId(this))
})

Given(
  'Agent v2 Backend service API access has been enabled with a key via API',
  async function (this: DifyWorld) {
    const agentId = getCurrentAgentId(this)
    const apiAccess = await setAgentApiAccess(agentId, true)
    const apiKey = await createAgentApiKey(agentId)

    this.agentBuilder.accessPoint.serviceApiBaseURL = apiAccess.service_api_base_url
    this.agentBuilder.accessPoint.generatedApiKey = apiKey.token
  },
)

Then('I should see the Agent v2 Backend service API endpoint', async function (this: DifyWorld) {
  const serviceApiCard = getServiceApiCard(this)

  if (!this.agentBuilder.accessPoint.serviceApiBaseURL)
    throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')

  await expect(serviceApiCard.getByRole('heading', { name: 'Backend service API' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(serviceApiCard.getByText('Service API Endpoint')).toBeVisible()
  await expect(serviceApiCard.getByText(this.agentBuilder.accessPoint.serviceApiBaseURL)).toBeVisible()
  await expect(serviceApiCard.getByLabel('Copy service API endpoint')).toBeEnabled()
})

When('I copy the Agent v2 Backend service API endpoint', async function (this: DifyWorld) {
  await getServiceApiCard(this).getByLabel('Copy service API endpoint').click()
})

Then(
  'the Agent v2 Backend service API endpoint should show it was copied',
  async function (this: DifyWorld) {
    await expect(this.getPage().getByLabel('Copied')).toBeVisible()
  },
)

When('I open Agent v2 API key management', async function (this: DifyWorld) {
  await getServiceApiCard(this)
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

  this.agentBuilder.accessPoint.generatedApiKey = (await generatedKey.textContent())?.trim()
  if (!this.agentBuilder.accessPoint.generatedApiKey)
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
    const fullSecret = this.agentBuilder.accessPoint.generatedApiKey
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

  this.agentBuilder.accessPoint.apiReferencePage = apiReferencePage
})

Then('the Agent v2 API Reference should open in a new tab', async function (this: DifyWorld) {
  const apiReferencePage = this.agentBuilder.accessPoint.apiReferencePage
  if (!apiReferencePage)
    throw new Error('No Agent v2 API Reference page was opened.')

  await expect(apiReferencePage).toHaveURL(/developing-with-apis/)
  await apiReferencePage.close()
  this.agentBuilder.accessPoint.apiReferencePage = undefined
})

When('I disable Agent v2 Backend service API access', async function (this: DifyWorld) {
  await getServiceApiCard(this).getByLabel('Toggle Backend service API access').click()
})

Then('Agent v2 Backend service API access should be out of service', async function (this: DifyWorld) {
  const serviceApiCard = getServiceApiCard(this)

  await expect(serviceApiCard.getByText('Out of service')).toBeVisible({ timeout: 30_000 })
})

When('I enable Agent v2 Backend service API access', async function (this: DifyWorld) {
  await getServiceApiCard(this).getByLabel('Toggle Backend service API access').click()
})

Then('Agent v2 Backend service API access should be in service', async function (this: DifyWorld) {
  const serviceApiCard = getServiceApiCard(this)

  await expect(serviceApiCard.getByText('In service')).toBeVisible({ timeout: 30_000 })
})

When('I send the Agent v2 Backend service API minimal request', async function (this: DifyWorld) {
  const serviceApiBaseURL = this.agentBuilder.accessPoint.serviceApiBaseURL
  const apiKey = this.agentBuilder.accessPoint.generatedApiKey
  if (!serviceApiBaseURL)
    throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')
  if (!apiKey)
    throw new Error('No Agent v2 API key found. Create a Backend service API key first.')

  this.agentBuilder.accessPoint.serviceApiResponse = await sendAgentServiceApiChatMessage({
    apiKey,
    serviceApiBaseURL,
  })
})

Then(
  'the Agent v2 Backend service API request should be rejected while disabled',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response)
      throw new Error('No Agent v2 Backend service API response was recorded.')

    expect(response.ok).toBe(false)
    expect(response.status).toBe(403)
    expect(JSON.stringify(response.body).toLowerCase()).toContain('disabled')
  },
)

Then(
  'the Agent v2 Backend service API request should succeed with the normal E2E marker',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response)
      throw new Error('No Agent v2 Backend service API response was recorded.')

    expect(response.ok).toBe(true)
    expect(JSON.stringify(response.body)).toContain(agentBuilderExpectedTokens.agentReply)
  },
)
