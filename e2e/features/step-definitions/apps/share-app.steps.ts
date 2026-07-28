import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps'
import { getAppSiteURL } from '../../../support/api/web-apps'
import { syncRunnableWorkflowDraft } from '../../../support/api/workflows'
import { createE2EResourceName } from '../../../support/naming'

Given('a workflow app has been published and shared via API', async function (this: DifyWorld) {
  const client = this.getConsoleClient()
  const app = await createTestApp(client, createE2EResourceName('App', 'Share'), 'workflow')
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
  await syncRunnableWorkflowDraft(client, app.id)
  await client.apps.byAppId.workflows.publish.post({
    body: { marked_comment: '', marked_name: '' },
    params: { app_id: app.id },
  })
  this.shareURL = getAppSiteURL(await client.apps.byAppId.get({ params: { app_id: app.id } }))
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
