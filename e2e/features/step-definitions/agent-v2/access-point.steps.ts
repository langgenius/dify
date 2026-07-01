import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  getAgentAccessPath,
  getAgentComposerDraft,
  getAgentReferencingWorkflows,
  setAgentApiAccess,
  setAgentSiteAccessAndGetURL,
} from '../../agent-v2/support/agent'
import {
  agentBuilderExpectedTokens,
  agentBuilderPreseededResources,
} from '../../agent-v2/support/agent-builder-resources'

const getCurrentAgentId = (world: DifyWorld) => {
  const agentId = world.createdAgentIds.at(-1)
  if (!agentId)
    throw new Error('No Agent v2 ID found. Create an Agent v2 test agent first.')

  return agentId
}

const getPreseededResource = (world: DifyWorld, name: string, kind: 'agent' | 'workflow') => {
  const resource = world.agentBuilder.preflight.preseededResources[name]
  if (!resource || resource.kind !== kind) {
    throw new Error(
      `Preseeded ${kind} "${name}" is not available. Run the matching preflight step first.`,
    )
  }

  return resource
}

const getAccessRegion = (world: DifyWorld) =>
  world.getPage().getByRole('region', { name: 'Access Point' })

const getWebAppCard = (world: DifyWorld) =>
  getAccessRegion(world).locator('article').filter({ hasText: 'Web app' }).first()

const getDialog = (world: DifyWorld, name: string | RegExp) =>
  world.getPage().getByRole('dialog', { name })

const closeDialog = async (world: DifyWorld, name: string | RegExp) => {
  const dialog = getDialog(world, name)

  await dialog.getByLabel('Close').click()
  await expect(dialog).not.toBeVisible()
}

Given(
  'Agent v2 Backend service API access has been enabled via API',
  async function (this: DifyWorld) {
    const apiAccess = await setAgentApiAccess(getCurrentAgentId(this), true)

    this.agentBuilder.accessPoint.serviceApiBaseURL = apiAccess.service_api_base_url
  },
)

Given(
  'Agent v2 Web app access will be restored for {string}',
  async function (this: DifyWorld, agentName: string) {
    const agent = getPreseededResource(this, agentName, 'agent')

    this.registerCleanup(async () => {
      await setAgentSiteAccessAndGetURL(agent.id, true)
    })
  },
)

When(
  'Agent v2 Web app access has been enabled via API',
  async function (this: DifyWorld) {
    this.agentBuilder.accessPoint.webAppURL = await setAgentSiteAccessAndGetURL(
      getCurrentAgentId(this),
      true,
    )
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

Then('I should see the Agent v2 Web app access URL', async function (this: DifyWorld) {
  const webAppCard = getWebAppCard(this)

  await expect(webAppCard.getByRole('heading', { name: 'Web app' })).toBeVisible()
  await expect(webAppCard.getByText('Access URL')).toBeVisible()
  await expect(webAppCard.getByLabel('Copy access URL')).toBeEnabled()
  await expect(webAppCard.getByRole('link', { name: 'Launch' })).toBeVisible()
})

Then(
  'I record the Agent v2 orchestration draft for {string}',
  async function (this: DifyWorld, agentName: string) {
    const agent = getPreseededResource(this, agentName, 'agent')
    const draft = await getAgentComposerDraft(agent.id)

    this.agentBuilder.accessPoint.composerDraftSnapshot = JSON.stringify(draft.agent_soul ?? {})
  },
)

When('I copy the Agent v2 Web app access URL', async function (this: DifyWorld) {
  await getWebAppCard(this).getByLabel('Copy access URL').click()
})

Then('the Agent v2 Web app access URL should show it was copied', async function (this: DifyWorld) {
  await expect(this.getPage().getByLabel('Copied')).toBeVisible()
})

When('I launch the Agent v2 Web app', async function (this: DifyWorld) {
  const launchLink = getWebAppCard(this).getByRole('link', { name: 'Launch' })
  const href = await launchLink.getAttribute('href')
  if (!href)
    throw new Error('Agent v2 Web app Launch link does not expose an href.')

  const [webAppPage] = await Promise.all([
    this.getPage().waitForEvent('popup'),
    launchLink.click(),
  ])

  this.agentBuilder.accessPoint.webAppURL = href
  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

When('I open the Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

When('I send an E2E message in the Agent v2 Web app', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  const messageInput = webAppPage.getByRole('textbox').last()
  await expect(messageInput).toBeEditable({ timeout: 30_000 })
  await messageInput.fill('Please reply with the test success marker.')
  await messageInput.press('Enter')
})

Then('the Agent v2 Web app should open in a new tab', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppPage || !webAppURL)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage).toHaveURL(webAppURL)
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
  this.agentBuilder.accessPoint.webAppURL = undefined
})

Then(
  'the Agent v2 Web app response should include the updated E2E marker',
  async function (this: DifyWorld) {
    const webAppPage = this.agentBuilder.accessPoint.webAppPage
    if (!webAppPage)
      throw new Error('No Agent v2 Web app page was opened.')

    await expect(webAppPage.getByText(agentBuilderExpectedTokens.updatedAgentReply))
      .toBeVisible({ timeout: 120_000 })
    await webAppPage.close()
    this.agentBuilder.accessPoint.webAppPage = undefined
  },
)

When('I open Agent v2 Embedded configuration', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Embedded' }).click()
})

Then('I should see the Agent v2 Embedded configuration dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Embed on website')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Embed on website')).toBeVisible()
  await expect(dialog.getByText(/iframe|script/i)).toBeVisible()
  await closeDialog(this, 'Embed on website')
})

When('I open Agent v2 Web app customization', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Customize' }).click()
})

Then('I should see the Agent v2 Web app customization dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Customize AI web app')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Customize AI web app')).toBeVisible()
  await expect(dialog.getByText(/NEXT_PUBLIC_APP_ID|NEXT_PUBLIC_API_URL/)).toBeVisible()
  await closeDialog(this, 'Customize AI web app')
})

When('I open Agent v2 Web app settings', async function (this: DifyWorld) {
  await getWebAppCard(this).getByRole('button', { name: 'Settings' }).click()
})

Then('I should see the Agent v2 Web app settings dialog', async function (this: DifyWorld) {
  const dialog = getDialog(this, 'Web App Settings')

  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Web App Settings')).toBeVisible()
  await expect(dialog.getByText('web app Name')).toBeVisible()
  await expect(dialog.getByText('web app Description')).toBeVisible()
  await closeDialog(this, 'Web App Settings')
})

Then(
  'the Agent v2 orchestration draft for {string} should be unchanged',
  async function (this: DifyWorld, agentName: string) {
    const snapshot = this.agentBuilder.accessPoint.composerDraftSnapshot
    if (!snapshot)
      throw new Error('No Agent v2 orchestration draft snapshot was recorded.')

    const agent = getPreseededResource(this, agentName, 'agent')
    const draft = await getAgentComposerDraft(agent.id)

    expect(JSON.stringify(draft.agent_soul ?? {})).toBe(snapshot)
  },
)

When('I disable Agent v2 Web app access', async function (this: DifyWorld) {
  const webAppCard = getWebAppCard(this)
  const launchLink = webAppCard.getByRole('link', { name: 'Launch' })
  const href = await launchLink.getAttribute('href')
  if (!href)
    throw new Error('Agent v2 Web app Launch link does not expose an href.')

  this.agentBuilder.accessPoint.webAppURL = href

  await webAppCard.getByLabel('Toggle Web app access').click()
})

Then('Agent v2 Web app access should be out of service', async function (this: DifyWorld) {
  const webAppCard = getWebAppCard(this)

  await expect(webAppCard.getByText('Out of service')).toBeVisible()
  await expect(webAppCard.getByRole('button', { name: 'Launch' })).toBeDisabled()
})

When('I open the disabled Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

Then('the disabled Agent v2 Web app should show an unavailable state', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage.getByText(/app is unavailable|site is disabled/i)).toBeVisible({
    timeout: 30_000,
  })
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
})

When('I enable Agent v2 Web app access', async function (this: DifyWorld) {
  await getWebAppCard(this).getByLabel('Toggle Web app access').click()
})

Then('Agent v2 Web app access should be in service', async function (this: DifyWorld) {
  const webAppCard = getWebAppCard(this)

  await expect(webAppCard.getByText('In service')).toBeVisible()
  await expect(webAppCard.getByRole('link', { name: 'Launch' })).toBeVisible()
})

When('I open the restored Agent v2 Web app URL', async function (this: DifyWorld) {
  const webAppURL = this.agentBuilder.accessPoint.webAppURL
  if (!webAppURL)
    throw new Error('No Agent v2 Web app URL was recorded.')
  if (!this.context)
    throw new Error('Playwright browser context has not been initialized.')

  const webAppPage = await this.context.newPage()
  await webAppPage.goto(webAppURL)

  this.agentBuilder.accessPoint.webAppPage = webAppPage
})

Then('the restored Agent v2 Web app should not show an unavailable state', async function (this: DifyWorld) {
  const webAppPage = this.agentBuilder.accessPoint.webAppPage
  if (!webAppPage)
    throw new Error('No Agent v2 Web app page was opened.')

  await expect(webAppPage.getByText(/app is unavailable|site is disabled/i)).not.toBeVisible()
  await webAppPage.close()
  this.agentBuilder.accessPoint.webAppPage = undefined
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

    this.agentBuilder.accessPoint.workflowReferencePage = workflowPage
  },
)

Then(
  'the Agent v2 Workflow access reference for {string} should open in Studio',
  async function (this: DifyWorld, workflowName: string) {
    const workflowPage = this.agentBuilder.accessPoint.workflowReferencePage
    if (!workflowPage)
      throw new Error('No Agent v2 Workflow access reference page was opened.')

    const workflow = getPreseededResource(this, workflowName, 'workflow')

    await expect(workflowPage).toHaveURL(new RegExp(`/app/${workflow.id}/workflow(?:\\?.*)?$`))
    await workflowPage.close()
    this.agentBuilder.accessPoint.workflowReferencePage = undefined
  },
)

Then('I should see the Agent v2 Backend service API endpoint', async function (this: DifyWorld) {
  const page = this.getPage()

  if (!this.agentBuilder.accessPoint.serviceApiBaseURL)
    throw new Error('No Agent v2 service API endpoint found. Enable Backend service API first.')

  await expect(page.getByRole('heading', { name: 'Backend service API' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Service API Endpoint')).toBeVisible()
  await expect(page.getByText(this.agentBuilder.accessPoint.serviceApiBaseURL)).toBeVisible()
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
