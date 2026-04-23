import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I open the context menu for the created app', async function (this: DifyWorld) {
  if (!this.appName) throw new Error('No app was created in this scenario.')

  const page = this.getPage()
  const appCard = page.locator('.group', { hasText: this.appName }).first()

  await expect(appCard).toBeVisible({ timeout: 30_000 })
  await appCard.hover()

  const moreButton = appCard.getByRole('button', { name: /more/i })
  await expect(moreButton).toBeVisible()
  await moreButton.click()
})

When('I click {string} in the context menu', async function (this: DifyWorld, menuItem: string) {
  const page = this.getPage()
  const menuButton = page.getByRole('button', { name: menuItem })

  await expect(menuButton).toBeVisible()
  await menuButton.click()
})

When('I confirm app deletion by typing the app name', async function (this: DifyWorld) {
  if (!this.appName) throw new Error('No app was created in this scenario.')

  const page = this.getPage()
  const dialog = page.getByRole('alertdialog')

  await expect(dialog).toBeVisible()
  await dialog.getByPlaceholder('Enter app name').fill(this.appName)
  await dialog.getByRole('button', { name: 'Confirm' }).click()
})

Then('the app should be deleted successfully', async function (this: DifyWorld) {
  await expect(this.getPage().getByText('App deleted')).toBeVisible({ timeout: 30_000 })
})
