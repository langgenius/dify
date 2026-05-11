import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { syncRunnableWorkflowDraft } from '../../../support/api'

Given('a minimal runnable workflow draft has been synced', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  if (!appId)
    throw new Error('No app ID found. Run "a \\"workflow\\" app has been created via API" first.')
  await syncRunnableWorkflowDraft(appId)
})

When('I run the workflow', async function (this: DifyWorld) {
  const page = this.getPage()
  const testRunButton = page.getByText('Test Run')

  await expect(testRunButton).toBeVisible({ timeout: 15_000 })
  await testRunButton.click()
})

Then('the workflow run should succeed', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.getByText('DETAIL').click()
  await expect(page.getByText('SUCCESS').first()).toBeVisible({ timeout: 55_000 })
})
