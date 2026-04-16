import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'
import type { DifyWorld } from '../../support/world'

Given('there is an existing E2E app available for testing', async function (this: DifyWorld) {
  const name = `E2E Test App ${Date.now()}`
  const app = await createTestApp(name)
  this.lastCreatedAppName = app.name
  this.createdAppIds.push(app.id)
})

When('I open the options menu for the last created E2E app', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) throw new Error('No app name stored. Run "I enter a unique E2E app name" first.')

  const page = this.getPage()
  // Hovering the name element triggers the CSS group-hover on the card,
  // making the More button visible for exactly this card.
  await page.getByText(appName, { exact: true }).hover()
  await page.getByRole('button', { name: 'More' }).click()
})

When('I click {string} in the app options menu', async function (this: DifyWorld, label: string) {
  await this.getPage().getByRole('button', { name: label }).click()
})

When('I confirm the app duplication', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('dialog')
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'Duplicate' }).click()
})
