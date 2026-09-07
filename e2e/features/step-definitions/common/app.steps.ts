import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { zCreateAppPayload } from '@dify/contracts/api/console/apps/zod.gen'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps'
import { syncMinimalWorkflowDraft } from '../../../support/api/workflows'
import { waitForAppsConsole } from '../../../support/apps'
import { createE2EResourceName } from '../../../support/naming'

Given('a {string} app has been created via API', async function (this: DifyWorld, mode: string) {
  const appMode = zCreateAppPayload.shape.mode.parse(mode)
  const app = await createTestApp(
    this.getConsoleClient(),
    createE2EResourceName('App', appMode),
    appMode,
  )
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
})

Given('a minimal workflow draft has been synced', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  if (!appId) throw new Error('No app is available for workflow draft setup.')
  await syncMinimalWorkflowDraft(this.getConsoleClient(), appId)
})

When('I open the app from the app list', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) throw new Error('No app is available to open from the app list.')

  const page = this.getPage()
  await page.goto('/apps')
  await waitForAppsConsole(page)
  const appLink = page.getByRole('link', { name: appName, exact: true })
  await expect(appLink).toBeVisible()
  await appLink.click()
})
