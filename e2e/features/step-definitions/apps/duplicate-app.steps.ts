import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'
import { createE2EResourceName } from '../../../support/naming'

Given('there is an existing E2E app available for testing', async function (this: DifyWorld) {
  const name = createE2EResourceName('App', 'Test')
  const app = await createTestApp(name, 'completion')
  this.lastCreatedAppName = app.name
  this.createdAppIds.push(app.id)
})

When('I open the options menu for the last created E2E app', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) throw new Error('No app name stored. Run "I enter a unique E2E app name" first.')

  const page = this.getPage()
  const appLink = page.getByRole('link', { name: appName, exact: true })
  const appCard = page
    .locator('div')
    .filter({ has: appLink })
    .filter({ has: page.getByRole('button', { name: 'More' }) })
    .last()
  await expect(appLink).toBeVisible()
  await appCard.hover()
  await appCard.getByRole('button', { name: 'More' }).click()
})

When('I click {string} in the app options menu', async function (this: DifyWorld, label: string) {
  await this.getPage().getByRole('menuitem', { name: label }).click()
})

When('I confirm the app duplication', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Duplicate' }).click()
})
