import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I search for the last created E2E app', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error(
      'No app name stored. Run "there is an existing E2E app available for testing" first.',
    )
  }

  const page = this.getPage()

  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()

  const searchInput = page.getByRole('textbox').last()

  await expect(searchInput).toBeVisible()
  await searchInput.fill(appName)

  await expect
    .poll(() => new URL(page.url()).searchParams.get('keywords'))
    .toBe(appName)
})

Then('I should see the last created E2E app in the apps console', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error(
      'No app name stored. Run "there is an existing E2E app available for testing" first.',
    )
  }

  await expect(this.getPage().getByText(appName, { exact: true })).toBeVisible()
})
