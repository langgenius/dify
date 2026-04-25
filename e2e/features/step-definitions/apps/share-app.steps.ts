import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp, enableAppSiteAndGetURL, publishWorkflowApp, syncRunnableWorkflowDraft } from '../../../support/api'

When('I enable the Web App share', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page.getByText('Web App')).toBeVisible({ timeout: 15_000 })
  const webAppCard = page.locator('div').filter({ hasText: /^Web App/ }).filter({ has: page.getByRole('switch') }).first()
  await webAppCard.getByRole('switch').click()
})

Then('the Web App should be in service', async function (this: DifyWorld) {
  await expect(this.getPage().getByText('In Service')).toBeVisible({ timeout: 10_000 })
})

Given('a workflow app has been published and shared via API', async function (this: DifyWorld) {
  const app = await createTestApp(`E2E Share ${Date.now()}`, 'workflow')
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
  await syncRunnableWorkflowDraft(app.id)
  await publishWorkflowApp(app.id)
  this.shareURL = await enableAppSiteAndGetURL(app.id)
})

When('I open the shared app URL', async function (this: DifyWorld) {
  if (!this.shareURL)
    throw new Error('No share URL available. Run "a workflow app has been published and shared via API" first.')
  await this.getPage().goto(this.shareURL, { timeout: 20_000 })
})

Then('the shared app page should be accessible', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/(workflow|chat)\/[a-zA-Z0-9]+/, { timeout: 15_000 })
  await expect(this.getPage().locator('body')).toBeVisible({ timeout: 10_000 })
})
