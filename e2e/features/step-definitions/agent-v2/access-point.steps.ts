import type { DifyWorld } from '../../support/world'
import type { AccessSurfaceName } from './access-point-helpers'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import {
  setAgentApiAccess,
  setAgentSiteAccessAndGetURL,
} from '../../agent-v2/support/access-point'
import { getAgentAccessPath, publishAgentWithPublishableDraft } from '../../agent-v2/support/agent'
import {
  getAccessRegion,
  getAccessSurfaceCard,
  getCurrentAgentId,
  getPreseededResource,
} from './access-point-helpers'

Given('the Agent v2 draft has been published via API', async function (this: DifyWorld) {
  await publishAgentWithPublishableDraft(getCurrentAgentId(this))
})

Given(
  /^Agent v2 (Web app|Backend service API) access has been enabled via API$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    if (surface === 'Web app') {
      this.agentBuilder.accessPoint.webAppURL = await setAgentSiteAccessAndGetURL(
        getCurrentAgentId(this),
        true,
      )
      return
    }

    const apiAccess = await setAgentApiAccess(getCurrentAgentId(this), true)
    this.agentBuilder.accessPoint.serviceApiBaseURL = apiAccess.service_api_base_url
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

    await page.goto('/agents')
    await page.getByRole('link', { name: agentName }).click()
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/configure(?:\\?.*)?$`))
    await page.getByRole('link', { name: 'Access Point' }).click()
    await expect(page).toHaveURL(new RegExp(`/agents/${agent.id}/access(?:\\?.*)?$`))
    await expect(page.getByRole('region', { name: 'Access Point' })).toBeVisible({
      timeout: 30_000,
    })
  },
)

When('I switch to the Agent v2 Access Point section', async function (this: DifyWorld) {
  const page = this.getPage()
  const agentId = getCurrentAgentId(this)

  await page.getByRole('link', { name: 'Access Point' }).click()
  await expect(page).toHaveURL(new RegExp(`/agents/${agentId}/access(?:\\?.*)?$`))
  await expect(page.getByRole('region', { name: 'Access Point' })).toBeVisible()
})

Then('I should see the Agent v2 Access Point overview', async function (this: DifyWorld) {
  const accessRegion = getAccessRegion(this)

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

When(
  /^I disable Agent v2 (Web app|Backend service API) access$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)

    if (surface === 'Web app') {
      const launchLink = accessSurfaceCard.getByRole('link', { name: 'Launch' })
      const href = await launchLink.getAttribute('href')
      if (!href)
        throw new Error('Agent v2 Web app Launch link does not expose an href.')

      this.agentBuilder.accessPoint.webAppURL = href
    }

    await accessSurfaceCard.getByLabel(`Toggle ${surface} access`).click()
  },
)

When(
  /^I enable Agent v2 (Web app|Backend service API) access$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    await getAccessSurfaceCard(this, surface).getByLabel(`Toggle ${surface} access`).click()
  },
)

Then(
  /^Agent v2 (Web app|Backend service API) access should be out of service$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)

    await expect(accessSurfaceCard.getByText('Out of service')).toBeVisible({ timeout: 30_000 })
    if (surface === 'Web app')
      await expect(accessSurfaceCard.getByRole('button', { name: 'Launch' })).toBeDisabled()
  },
)

Then(
  /^Agent v2 (Web app|Backend service API) access should be in service$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)

    await expect(accessSurfaceCard.getByText('In service')).toBeVisible({ timeout: 30_000 })
    if (surface === 'Web app')
      await expect(accessSurfaceCard.getByRole('link', { name: 'Launch' })).toBeVisible()
  },
)
