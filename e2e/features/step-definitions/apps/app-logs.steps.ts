import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I navigate to the app logs page', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  if (!appId)
    throw new Error('No app ID found. Run "a \"workflow\" app has been created via API" first.')

  await this.getPage().goto(`/app/${appId}/logs`)
})

Then('I should be on the app logs page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/logs(?:\?.*)?$/, { timeout: 30_000 })
})
