import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { getAgentAccessPath } from '../../agent-v2/support/agent'
import {
  getAccessRegion,
  getCurrentAgentId,
  getPreseededResource,
} from './access-point-helpers'

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
