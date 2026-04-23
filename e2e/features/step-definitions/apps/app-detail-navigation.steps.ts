import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'

Given('a {string} app has been created via API', async function (this: DifyWorld, mode: string) {
  const app = await createTestApp(`E2E Nav ${Date.now()}`, mode)
  this.createdAppIds.push(app.id)
  this.lastCreatedAppName = app.name
})

When('I open the app from the app list', async function (this: DifyWorld) {
  const page = this.getPage()
  await page.goto('/apps')
  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
  await page.getByText(this.lastCreatedAppName!).click()
})

When('I navigate to the app develop page', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  await this.getPage().goto(`/app/${appId}/develop`)
})

When('I navigate to the app overview page', async function (this: DifyWorld) {
  const appId = this.createdAppIds.at(-1)
  await this.getPage().goto(`/app/${appId}/overview`)
})

Then('I should be on the app develop page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/develop(?:\?.*)?$/, { timeout: 30_000 })
})

Then('I should be on the app overview page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/overview(?:\?.*)?$/, { timeout: 30_000 })
})
