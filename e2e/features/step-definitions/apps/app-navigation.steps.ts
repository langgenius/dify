import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I click the monitoring tab', async function (this: DifyWorld) {
  const page = this.getPage()

  // Click the "Monitoring" or "Logs & Ann." tab in the app detail sidebar
  const monitoringTab = page.getByText('Monitoring').or(page.getByText('Logs & Ann.'))
  await expect(monitoringTab.first()).toBeVisible({ timeout: 10_000 })
  await monitoringTab.first().click()
})

Then('I should see the monitoring page content', async function (this: DifyWorld) {
  const page = this.getPage()

  // The URL should contain /logs or /overview
  await expect(page).toHaveURL(/\/app\/[^/]+\/(logs|overview)/, { timeout: 10_000 })
})

When('I click the orchestrate tab', async function (this: DifyWorld) {
  const page = this.getPage()

  const orchestrateTab = page.getByText('Orchestrate')
  await expect(orchestrateTab.first()).toBeVisible({ timeout: 10_000 })
  await orchestrateTab.first().click()
})
