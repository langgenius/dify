import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp, syncMinimalWorkflowDraft } from '../../../support/api'
import { waitForAppsConsole } from '../../../support/apps'
import { createE2EResourceName } from '../../../support/naming'

Given('a {string} app has been created via API', async function (this: DifyWorld, mode: string) {
  const app = await createTestApp(createE2EResourceName('App', mode), mode)
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
  await waitForAppsConsole(page)
  const appLink = page.getByRole('link', { name: this.lastCreatedAppName!, exact: true })
  await expect(appLink).toBeVisible()
  await appLink.click()
})
