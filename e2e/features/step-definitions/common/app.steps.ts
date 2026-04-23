import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp, syncMinimalWorkflowDraft } from '../../../support/api'

Given('a {string} app has been created via API', async function (this: DifyWorld, mode: string) {
  const app = await createTestApp(`E2E ${Date.now()}`, mode)
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
})

Given('a minimal workflow draft has been synced', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)!
  await syncMinimalWorkflowDraft(appId)
})

When('I open the app from the app list', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.goto('/apps')
  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
  await page.getByText(this.lastCreatedAppName!).click()
})
