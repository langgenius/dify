import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'

Given('a {string} app has been created via API', async function (this: DifyWorld, mode: string) {
  const app = await createTestApp(`E2E Publish ${Date.now()}`, mode)
  this.createdAppIds.push(app.id)
})

When('I navigate to the app detail page', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  await this.getPage().goto(`/app/${appId}`)
})

When('I open the publish panel', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Publish' }).first().click()
})

When('I publish the app', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: /Publish Update/ }).click()
})

Then('the app should be marked as published', async function (this: DifyWorld) {
  await expect(this.getPage().getByRole('button', { name: 'Published' })).toBeVisible({ timeout: 30_000 })
})
