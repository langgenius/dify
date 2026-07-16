import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  createAgentApiKey,
  sendAgentServiceApiChatMessage,
  setAgentApiAccess,
} from '../../agent-v2/support/access-point'
import {
  agentBuilderExpectedTokens,
  agentBuilderFixedInputs,
} from '../../agent-v2/support/agent-builder-resources'
import { SERVICE_API_RUNTIME_STEP_TIMEOUT_MS } from '../../agent-v2/support/service-api-sse'
import { getCurrentAgentId, getServiceApiCard } from './access-point-helpers'

async function enableAgentApiAccessWithKey(world: DifyWorld) {
  const agentId = getCurrentAgentId(world)
  const apiAccess = await setAgentApiAccess(agentId, true)
  const apiKey = await createAgentApiKey(agentId)

  world.agentBuilder.accessPoint.serviceApiBaseURL = apiAccess.service_api_base_url
  world.agentBuilder.accessPoint.generatedApiKey = apiKey.token
}

Given(
  'Agent v2 Backend service API access has been enabled with a key via API',
  async function (this: DifyWorld) {
    await enableAgentApiAccessWithKey(this)
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
  await expect(
    serviceApiCard.getByText(this.agentBuilder.accessPoint.serviceApiBaseURL),
  ).toBeVisible()
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
  const existingSecret = this.agentBuilder.accessPoint.generatedApiKey

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Secret Key', { exact: true })).toBeVisible()
  await expect(dialog.getByText('CREATED', { exact: true })).toBeVisible()
  await expect(dialog.getByText('LAST USED', { exact: true })).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Create new Secret key' })).toBeVisible()
  if (existingSecret)
    await expect(dialog.getByText(existingSecret, { exact: true })).not.toBeVisible()
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

When('I copy the newly generated Agent v2 API key', async function (this: DifyWorld) {
  const generatedKeyDialog = this.getPage()
    .getByRole('dialog', { name: /API Secret key/i })
    .last()

  await generatedKeyDialog.getByLabel('Copy').first().click()
})

Then(
  'the newly generated Agent v2 API key should show it was copied',
  async function (this: DifyWorld) {
    const generatedKeyDialog = this.getPage()
      .getByRole('dialog', { name: /API Secret key/i })
      .last()

    await expect(generatedKeyDialog.getByLabel('Copied')).toBeVisible()
  },
)

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
    if (!fullSecret) throw new Error('No generated Agent v2 API key found.')

    const apiKeyDialog = this.getPage().getByRole('dialog', { name: /API Secret key/i })

    await expect(apiKeyDialog).toBeVisible()
    await expect(apiKeyDialog.getByText(fullSecret, { exact: true })).not.toBeVisible()
    await expect(apiKeyDialog.getByText(/^app-/)).not.toBeVisible()
    await expect(apiKeyDialog.getByLabel('Copy').first()).toBeVisible()
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
  await expect(apiReferenceLink).toHaveAttribute('href', /\/api-reference\/guides\/get-started/)
  await expect(apiReferenceLink).toHaveAttribute('target', '_blank')

  const [apiReferencePage] = await Promise.all([
    page.waitForEvent('popup'),
    apiReferenceLink.click(),
  ])

  this.agentBuilder.accessPoint.apiReferencePage = apiReferencePage
})

Then('the Agent v2 API Reference should open in a new tab', async function (this: DifyWorld) {
  const apiReferencePage = this.agentBuilder.accessPoint.apiReferencePage
  if (!apiReferencePage) throw new Error('No Agent v2 API Reference page was opened.')

  await expect(apiReferencePage).toHaveURL(/\/api-reference\/guides\/get-started/)
  await apiReferencePage.close()
  this.agentBuilder.accessPoint.apiReferencePage = undefined
})

When(
  'I send the Agent v2 Backend service API minimal request',
  { timeout: SERVICE_API_RUNTIME_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
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
  },
)

When(
  'I send the Agent v2 Backend service API knowledge request',
  { timeout: SERVICE_API_RUNTIME_STEP_TIMEOUT_MS },
  async function (this: DifyWorld) {
    const serviceApiBaseURL = this.agentBuilder.accessPoint.serviceApiBaseURL
    const apiKey = this.agentBuilder.accessPoint.generatedApiKey
    if (!serviceApiBaseURL)
      throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')
    if (!apiKey)
      throw new Error('No Agent v2 API key found. Create a Backend service API key first.')

    this.agentBuilder.accessPoint.serviceApiResponse = await sendAgentServiceApiChatMessage({
      apiKey,
      query: agentBuilderFixedInputs.knowledgeRuntimeQuery,
      serviceApiBaseURL,
    })
  },
)

const stringifyServiceApiBody = (body: unknown) => {
  try {
    return JSON.stringify(body)
  } catch {
    return String(body)
  }
}

const expectServiceApiResponseOK = (
  response: NonNullable<DifyWorld['agentBuilder']['accessPoint']['serviceApiResponse']>,
  action: string,
) => {
  if (response.ok) return

  throw new Error(
    `${action} failed with ${response.status}: ${stringifyServiceApiBody(response.body)}`,
  )
}

const expectServiceApiResponseIncludes = (
  response: NonNullable<DifyWorld['agentBuilder']['accessPoint']['serviceApiResponse']>,
  expectedToken: string,
  action: string,
) => {
  expectServiceApiResponseOK(response, action)

  const body = stringifyServiceApiBody(response.body)
  if (!body.includes(expectedToken))
    throw new Error(`${action} response did not include ${expectedToken}: ${body}`)
}

Then(
  'the Agent v2 Backend service API request should be rejected while disabled',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response) throw new Error('No Agent v2 Backend service API response was recorded.')

    expect(response.ok).toBe(false)
    expect(response.status).toBe(403)
    expect(JSON.stringify(response.body).toLowerCase()).toContain('disabled')
  },
)

Then(
  'the Agent v2 Backend service API response should include the knowledge E2E marker',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response) throw new Error('No Agent v2 Backend service API response was recorded.')

    expectServiceApiResponseIncludes(
      response,
      agentBuilderExpectedTokens.knowledgeReply,
      'Agent v2 Backend service API knowledge request',
    )
  },
)

Then(
  'the Agent v2 Backend service API request should succeed with the normal E2E marker',
  async function (this: DifyWorld) {
    const response = this.agentBuilder.accessPoint.serviceApiResponse
    if (!response) throw new Error('No Agent v2 Backend service API response was recorded.')

    expectServiceApiResponseIncludes(
      response,
      agentBuilderExpectedTokens.agentReply,
      'Agent v2 Backend service API request',
    )
  },
)
