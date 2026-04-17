import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I type the app name in the deletion confirmation', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error(
      'No app name stored. Run "there is an existing E2E app available for testing" first.',
    )
  }

  const page = this.getPage()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Enter app name…').fill(appName)
})

When('I confirm the deletion', async function (this: DifyWorld) {
  const dialog = this.getPage().getByRole('alertdialog')
  await dialog.getByRole('button', { name: 'Confirm' }).click()
})

Then('the app should no longer appear in the apps console', async function (this: DifyWorld) {
  const appName = this.lastCreatedAppName
  if (!appName) {
    throw new Error(
      'No app name stored. Run "there is an existing E2E app available for testing" first.',
    )
  }

  await expect(this.getPage().getByTitle(appName)).not.toBeVisible({
    timeout: 10_000,
  })
})
