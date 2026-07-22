import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps'
import { enableAppSiteAndGetURL } from '../../../support/api/web-apps'
import { publishWorkflowApp, syncRunnableWorkflowDraft } from '../../../support/api/workflows'
import { createE2EResourceName } from '../../../support/naming'

Given('a workflow app has been published and shared via API', async function (this: DifyWorld) {
  const app = await createTestApp(createE2EResourceName('App', 'Share'), 'workflow')
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
  await syncRunnableWorkflowDraft(app.id)
  await publishWorkflowApp(app.id)
  this.shareURL = await enableAppSiteAndGetURL(app.id)
})

When('I open the shared app URL', async function (this: DifyWorld) {
  if (!this.shareURL) {
    throw new Error(
      'No share URL available. Run "a workflow app has been published and shared via API" first.',
    )
  }
  await this.getPage().goto(this.shareURL, { timeout: 20_000 })
})

Then('the shared app page should be accessible', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/(workflow|chat)\/[a-zA-Z0-9]+/, { timeout: 15_000 })
  await expect(this.getPage().getByRole('button', { name: 'Execute' })).toBeVisible({
    timeout: 10_000,
  })
})

When('I run the shared workflow app', async function (this: DifyWorld) {
  const page = this.getPage()
  const runButton = page.getByRole('button', { name: 'Execute' })

  await expect(runButton).toBeEnabled({ timeout: 15_000 })
  await runButton.click()
})

Then('the shared workflow run should succeed', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('img', { name: 'Workflow Process succeeded' })).toBeVisible(
    { timeout: 55_000 },
  )
})
