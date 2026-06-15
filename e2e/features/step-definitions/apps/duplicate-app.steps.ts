import type { DifyWorld } from '../../support/world'
import { Given, When } from '@cucumber/cucumber'
import { createTestApp } from '../../../support/api'

Given('there is an existing E2E app available for testing', async function (this: DifyWorld) {
  const name = `E2E Test App ${Date.now()}`
  const app = await createTestApp(name, 'completion')
  this.lastCreatedAppName = app.name
  this.createdAppIds.push(app.id)
})

When('I open the options menu for the last created E2E app', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName)
    throw new Error('No app name stored. Run "I enter a unique E2E app name" first.')

  const page = this.getPage()
  // Scope to the specific card: the card root is the innermost div that contains
  // both the unique app name text and a More button (they are in separate branches,
  // so no child div satisfies both). .last() picks the deepest match in DOM order.
  const appCard = page
    .locator('div')
    .filter({ has: page.getByText(appName, { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'More' }) })
    .last()
  await appCard.hover()
  await appCard.getByRole('button', { name: 'More' }).click()
})

When('I click {string} in the app options menu', async function (this: DifyWorld, label: string) {
  await this.getPage().getByRole('menuitem', { name: label }).click()
})

When('I confirm the app duplication', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Duplicate' }).click()
})
