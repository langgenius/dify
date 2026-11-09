import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps.ts'
import { getAppSiteURL } from '../../../support/api/web-apps.ts'
import { syncRunnableWorkflowDraft } from '../../../support/api/workflows.ts'
import { createE2EResourceName } from '../../../support/naming.ts'

Given('a model-free echo Chatflow has been published via API', async function (this: DifyWorld) {
  const client = this.getConsoleClient()
  const app = await createTestApp(
    client,
    createE2EResourceName('App', 'Chatflow history'),
    'advanced-chat',
  )
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
  await syncRunnableWorkflowDraft(client, app.id, {
    mode: 'advanced-chat',
    answer: 'Echo: {{#sys.query#}}',
  })
  await client.apps.byAppId.workflows.publish.post({
    params: { app_id: app.id },
    body: { marked_name: '', marked_comment: '' },
  })
  this.shareURL = getAppSiteURL(await client.apps.byAppId.get({ params: { app_id: app.id } }))
})

When(
  'I send {string} to the published Chatflow',
  async function (this: DifyWorld, message: string) {
    const page = this.getPage()
    const input = page.getByPlaceholder(/^Talk to /)
    await expect(input).toBeEditable({ timeout: 30_000 })
    await input.fill(message)
    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toBeEnabled()
    await send.click()
  },
)

Then(
  'the published Chatflow should answer {string}',
  async function (this: DifyWorld, answer: string) {
    await expect(this.getPage().getByText(answer, { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(
      this.getPage().getByRole('button', { name: 'Start New chat', exact: true }),
    ).toBeEnabled()
  },
)
