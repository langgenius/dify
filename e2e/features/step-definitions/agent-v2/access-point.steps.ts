import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  getAgentAccessPath,
  getAgentReferencingWorkflows,
  setAgentApiAccess,
} from '../../../support/agent'
import { agentBuilderPreseededResources } from '../../../support/agent-builder-resources'

const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

const getPreseededResource = (world: DifyWorld, name: string, kind: 'agent' | 'workflow') => {
  const resource = world.agentBuilderPreseededResources[name]
  if (!resource || resource.kind !== kind) {
    throw new Error(
      `Preseeded ${kind} "${name}" is not available. Run the matching preflight step first.`,
    )
  }

  return resource
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

When(
  'I open the preseeded Agent v2 Access Point page for {string} from the Agent Roster',
  async function (this: DifyWorld, agentName: string) {
    const page = this.getPage()
    const agent = getPreseededResource(this, agentName, 'agent')

    await page.goto('/roster')
    await page.getByRole('link', { name: agentName }).click()
    await expect(page).toHaveURL(new RegExp(`/roster/agent/${agent.id}/configure(?:\\?.*)?$`))
    await page.getByRole('link', { name: 'Access Point' }).click()
    await expect(page).toHaveURL(new RegExp(`/roster/agent/${agent.id}/access(?:\\?.*)?$`))
    await expect(page.getByRole('region', { name: 'Access Point' })).toBeVisible({
      timeout: 30_000,
    })
  },
)

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
  await expect(accessRegion.getByText('Access URL')).toBeVisible()
  await expect(accessRegion.getByLabel('Copy access URL')).toBeVisible()
  await expect(accessRegion.getByLabel('Toggle Web app access')).toBeVisible()
  await expect(accessRegion.getByRole('link', { name: 'Launch' })).toBeVisible()
  await expect(accessRegion.getByRole('button', { name: 'Embedded' })).toBeVisible()
  await expect(accessRegion.getByRole('button', { name: 'Customize' })).toBeVisible()
  await expect(accessRegion.getByRole('button', { name: 'Settings' })).toBeVisible()
  await expect(accessRegion.getByRole('heading', { name: 'Backend service API' })).toBeVisible()
  await expect(accessRegion.getByText('Service API Endpoint')).toBeVisible()
  await expect(accessRegion.getByLabel('Copy service API endpoint')).toBeVisible()
  await expect(accessRegion.getByLabel('Toggle Backend service API access')).toBeVisible()
  await expect(accessRegion.getByRole('button', { name: /^API Key\b/ })).toBeVisible()
  await expect(accessRegion.getByRole('link', { name: 'API Reference' })).toBeVisible()
  await expect(accessRegion.getByText(/^(?:In|Out of) service$/i)).toHaveCount(2)
  await expect(accessRegion.getByRole('heading', { name: 'Workflow access' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Name' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Version' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Nodes' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Last updated' })).toBeVisible()
  await expect(accessRegion.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
  await expect(accessRegion.getByText('No workflow references yet.')).toBeVisible()
})

Then(
  'I should see the Agent v2 Workflow access reference for {string}',
  async function (this: DifyWorld, workflowName: string) {
    const page = this.getPage()
    const workflow = getPreseededResource(this, workflowName, 'workflow')
    const agent = getPreseededResource(
      this,
      agentBuilderPreseededResources.workflowReferenceAgent,
      'agent',
    )
    const references = await getAgentReferencingWorkflows(agent.id)
    const reference = references.find(item => item.app_id === workflow.id || item.app_name === workflow.name)
    if (!reference)
      throw new Error(`Agent "${agent.name}" does not reference workflow "${workflow.name}".`)

    const accessRegion = page.getByRole('region', { name: 'Access Point' })
    const workflowSection = accessRegion.getByRole('region', { name: 'Workflow access' })
    const row = workflowSection.getByRole('row').filter({ hasText: workflowName })
    const nodeCount = reference.node_ids?.length ?? 0

    await expect(accessRegion.getByRole('columnheader', { name: 'Name' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Version' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Nodes' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Last updated' })).toBeVisible()
    await expect(accessRegion.getByRole('columnheader', { name: 'Actions' })).toBeVisible()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row.getByText(reference.workflow_version, { exact: true })).toBeVisible()
    await expect(row.getByText(new RegExp(`^${nodeCount} nodes?$`))).toBeVisible()
    if (reference.app_updated_at == null)
      await expect(row.getByText('N/A', { exact: true })).toBeVisible()
    else
      await expect(row.getByText('N/A', { exact: true })).not.toBeVisible()
    await expect(row.getByRole('link', { name: `Open ${workflowName} in Studio` })).toBeVisible()
  },
)

When(
  'I open the Agent v2 Workflow access reference for {string}',
  async function (this: DifyWorld, workflowName: string) {
    const page = this.getPage()
    const workflowLink = page.getByRole('link', { name: `Open ${workflowName} in Studio` })

    const [workflowPage] = await Promise.all([
      page.waitForEvent('popup'),
      workflowLink.click(),
    ])

    this.lastAgentWorkflowReferencePage = workflowPage
  },
)

Then(
  'the Agent v2 Workflow access reference for {string} should open in Studio',
  async function (this: DifyWorld, workflowName: string) {
    const workflowPage = this.lastAgentWorkflowReferencePage
    if (!workflowPage)
      throw new Error('No Agent v2 Workflow access reference page was opened.')

    const workflow = getPreseededResource(this, workflowName, 'workflow')

    await expect(workflowPage).toHaveURL(new RegExp(`/app/${workflow.id}/workflow(?:\\?.*)?$`))
    await workflowPage.close()
    this.lastAgentWorkflowReferencePage = undefined
  },
)

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
