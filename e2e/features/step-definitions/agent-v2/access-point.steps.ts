import type { DifyWorld } from '../../support/world'
import type { AccessSurfaceName } from './access-point-helpers'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { publishAgentWithPublishableDraft } from '../../agent-v2/support/agent'
import {
  getAccessSurfaceCard,
  getCurrentAgentId,
  getPreseededResource,
  getServiceApiCard,
  getWebAppCard,
} from './access-point-helpers'

const toggleAgentAccess = async (
  world: DifyWorld,
  surface: AccessSurfaceName,
  enabled: boolean,
) => {
  const agentId = getCurrentAgentId(world)
  const client = world.getConsoleClient()
  const toggle = getAccessSurfaceCard(world, surface).getByLabel(`Toggle ${surface} access`)

  await expect(toggle).toBeEnabled()
  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-checked', String(enabled))

  await expect
    .poll(async () => {
      if (surface === 'Web app') {
        const agent = await client.agent.byAgentId.get({ params: { agent_id: agentId } })
        return agent.enable_site
      }

      const apiAccess = await client.agent.byAgentId.apiAccess.get({
        params: { agent_id: agentId },
      })
      return apiAccess.enabled
    })
    .toBe(enabled)
}

Given('the Agent v2 draft has been published via API', async function (this: DifyWorld) {
  await publishAgentWithPublishableDraft(this.getConsoleClient(), getCurrentAgentId(this))
})

When('I republish the Agent v2 draft via API', async function (this: DifyWorld) {
  await publishAgentWithPublishableDraft(this.getConsoleClient(), getCurrentAgentId(this))
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

Then(
  'the unpublished Agent v2 access surfaces should be unavailable',
  async function (this: DifyWorld) {
    const webAppCard = getWebAppCard(this)
    const serviceApiCard = getServiceApiCard(this)

    await expect(webAppCard.getByText('Out of service')).toBeVisible({ timeout: 30_000 })
    await expect(webAppCard.getByLabel('Toggle Web app access')).toBeDisabled()
    await expect(webAppCard.getByRole('button', { name: 'Launch' })).toBeDisabled()
    await expect(serviceApiCard.getByText('Out of service')).toBeVisible()
    await expect(serviceApiCard.getByLabel('Toggle Backend service API access')).toBeDisabled()
    await expect(serviceApiCard.getByRole('button', { name: /^API Key\b/ })).toBeDisabled()
  },
)

When(
  /^I disable Agent v2 (Web app|Backend service API) access$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)

    if (surface === 'Web app') {
      const launchLink = accessSurfaceCard.getByRole('link', { name: 'Launch' })
      const href = await launchLink.getAttribute('href')
      if (!href) throw new Error('Agent v2 Web app Launch link does not expose an href.')

      this.agentBuilder.accessPoint.webAppURL = href
    }

    await toggleAgentAccess(this, surface, false)
  },
)

When(
  /^I enable Agent v2 (Web app|Backend service API) access$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    await toggleAgentAccess(this, surface, true)
  },
)

Then(
  /^Agent v2 (Web app|Backend service API) access should be out of service$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)
    const toggle = accessSurfaceCard.getByLabel(`Toggle ${surface} access`)

    await expect(accessSurfaceCard.getByText('Out of service')).toBeVisible({ timeout: 30_000 })
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    if (surface === 'Web app')
      await expect(accessSurfaceCard.getByRole('button', { name: 'Launch' })).toBeDisabled()
  },
)

Then(
  /^Agent v2 (Web app|Backend service API) access should be in service$/,
  async function (this: DifyWorld, surface: AccessSurfaceName) {
    const accessSurfaceCard = getAccessSurfaceCard(this, surface)
    const toggle = accessSurfaceCard.getByLabel(`Toggle ${surface} access`)

    await expect(accessSurfaceCard.getByText('In service')).toBeVisible({ timeout: 30_000 })
    await expect(toggle).toBeEnabled()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    if (surface === 'Web app')
      await expect(accessSurfaceCard.getByRole('link', { name: 'Launch' })).toBeVisible()
  },
)
