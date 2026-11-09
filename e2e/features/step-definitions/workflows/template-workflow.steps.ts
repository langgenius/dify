import type { DifyWorld } from '../../support/world.ts'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api/apps.ts'
import { getAppSiteURL } from '../../../support/api/web-apps.ts'
import { createE2EResourceName } from '../../../support/naming.ts'
import {
  createTemplateWorkflowDraft,
  getSavedWorkflowTemplate,
  templateNodeId,
} from '../../../support/workflows-template.ts'

async function createTemplateWorkflow(world: DifyWorld, template: string) {
  const client = world.getConsoleClient()
  const app = await createTestApp(client, createE2EResourceName('App', 'Template'), 'workflow')
  world.createdAppIds.push(app.id)
  world.lastCreatedAppName = app.name
  await client.apps.byAppId.workflows.draft.post({
    body: createTemplateWorkflowDraft(template),
    params: { app_id: app.id },
  })
  return app.id
}

Given(
  'a template workflow returning {string} has been created',
  async function (this: DifyWorld, template: string) {
    await createTemplateWorkflow(this, template)
  },
)

Given(
  'a template workflow returning {string} has been published',
  async function (this: DifyWorld, template: string) {
    const appId = await createTemplateWorkflow(this, template)
    const client = this.getConsoleClient()
    await client.apps.byAppId.workflows.publish.post({
      body: { marked_comment: '', marked_name: '' },
      params: { app_id: appId },
    })
    this.shareURL = getAppSiteURL(await client.apps.byAppId.get({ params: { app_id: appId } }))
  },
)

When(
  'I change the workflow result template to {string}',
  async function (this: DifyWorld, template: string) {
    const page = this.getPage()
    await page.getByTestId(`rf__node-${templateNodeId}`).click()
    const editor = page.getByRole('textbox', { name: /^Editor content/ })
    await expect(editor).toBeVisible({ timeout: 15_000 })
    // Monaco owns keyboard editing; filling its DOM input bypasses that model.
    await editor.press('ControlOrMeta+A')
    await editor.pressSequentially(template)
  },
)

Then(
  'the workflow result template should be saved as {string}',
  async function (this: DifyWorld, template: string) {
    const appId = this.createdAppIds.at(-1)
    if (!appId) throw new Error('Create the template workflow before checking its draft.')
    await expect
      .poll(() => getSavedWorkflowTemplate(this.getConsoleClient(), appId), { timeout: 30_000 })
      .toBe(template)
    await expect(
      this.getPage().getByRole('status', { name: 'Workflow save status' }),
    ).toContainText('Auto-Saved')
  },
)

When('I reload the workflow editor', async function (this: DifyWorld) {
  await this.getPage().reload()
})

Then(
  'the workflow template editor should contain {string}',
  async function (this: DifyWorld, template: string) {
    const page = this.getPage()
    await page.getByTestId(`rf__node-${templateNodeId}`).click()
    await expect(page.getByRole('textbox', { name: /^Editor content/ })).toBeVisible({
      timeout: 15_000,
    })
    await expect(page.getByText(template, { exact: true })).toBeVisible()
  },
)

Then(
  'the workflow test run should return {string}',
  { timeout: 70_000 },
  async function (this: DifyWorld, result: string) {
    const page = this.getPage()
    await page.getByText('DETAIL', { exact: true }).click()
    await expect(page.getByRole('status').getByText('Success', { exact: true })).toBeVisible({
      timeout: 55_000,
    })
    await page.getByText('RESULT', { exact: true }).click()
    await expect(page.getByRole('paragraph').filter({ hasText: result })).toHaveText(result)
  },
)

When('I publish the workflow update', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.getByRole('button', { name: 'Publish', exact: true }).click()
  const publisher = page.getByRole('dialog')
  await publisher.getByRole('button', { name: 'Publish Update', exact: true }).click()
  await expect(publisher.getByRole('button', { name: 'Published', exact: true })).toBeVisible({
    timeout: 30_000,
  })
})

When(
  'the anonymous visitor executes the published template workflow',
  async function (this: DifyWorld) {
    const page = this.sharedAppPage
    if (!page) throw new Error('Open the workflow Web App as an anonymous visitor first.')
    // A new page load removes the previous run, so its output cannot satisfy the next assertion.
    await page.reload()
    await page.getByRole('button', { name: 'Execute', exact: true }).click()
  },
)

Then(
  'the published template workflow should return {string}',
  { timeout: 70_000 },
  async function (this: DifyWorld, result: string) {
    const page = this.sharedAppPage
    if (!page) throw new Error('Open the workflow Web App as an anonymous visitor first.')
    await expect(page.getByRole('img', { name: 'Workflow Process succeeded' })).toBeVisible({
      timeout: 55_000,
    })
    await expect(page.getByRole('paragraph').filter({ hasText: result })).toHaveText(result)
  },
)
