import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp, enableAppSiteAndGetURL, publishWorkflowApp, syncRunnableWorkflowDraft } from '../../../support/api'

When('I enable the Web App share', async function (this: DifyWorld) {
  const page = this.getPage()
  const appName = this.lastCreatedAppName
  if (!appName)
    throw new Error('No app name available. Run "a \\"workflow\\" app has been created via API" first.')

  await page.locator('button').filter({ hasText: appName }).filter({ hasText: 'Workflow' }).click()
  await expect(page.getByRole('switch').first()).toBeEnabled({ timeout: 15_000 })
  await page.getByRole('switch').first().click()
})

Then('the Web App should be in service', async function (this: DifyWorld) {
  await expect(this.getPage().getByText('In Service').first()).toBeVisible({ timeout: 10_000 })
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

When('I run the shared workflow app', async function (this: DifyWorld) {
  const page = this.getPage()
  const runButton = page.getByRole('button', { name: 'Execute' })

  await expect(runButton).toBeEnabled({ timeout: 15_000 })
  await runButton.click()
})

Then('the shared workflow run should succeed', async function (this: DifyWorld) {
  await expect(this.getPage().getByTestId('status-icon-success')).toBeVisible({ timeout: 55_000 })
})
