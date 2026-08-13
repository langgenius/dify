import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I open the publish panel', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Publish', exact: true }).click()
})

When('I publish the app', async function (this: DifyWorld) {
  const publishPanel = this.getPage().getByRole('dialog')
  await publishPanel.getByRole('button', { name: 'Publish', exact: true }).click()
})

Then('the app should be marked as published', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('button', { name: 'Published' })).toBeVisible({
    timeout: 30_000,
  })
})
