import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I update the app name to {string}', async function (this: DifyWorld, newName: string) {
  const page = this.getPage()
  const dialog = page.getByRole('dialog')

  await expect(dialog).toBeVisible()

  const nameInput = dialog.getByPlaceholder('Give your app a name')
  await expect(nameInput).toBeVisible()
  await nameInput.clear()
  await nameInput.fill(newName)
  this.lastCreatedAppName = newName
})

When('I update the app description to {string}', async function (this: DifyWorld, description: string) {
  const page = this.getPage()
  const dialog = page.getByRole('dialog')

  const descriptionInput = dialog.getByRole('textbox').last()
  await expect(descriptionInput).toBeVisible()
  await descriptionInput.clear()
  await descriptionInput.fill(description)
})

When('I save the app settings', async function (this: DifyWorld) {
  const page = this.getPage()
  const saveButton = page.getByRole('button', { name: 'Save' })

  await expect(saveButton).toBeEnabled()
  await saveButton.click()

  // Wait for the dialog to close after saving
  await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 10_000 })
})

Then(
  'the app should display the updated name in the apps console',
  async function (this: DifyWorld) {
    const appName = this.lastCreatedAppName
    if (!appName)
      throw new Error('No app name stored. Run "I update the app name to ..." first.')

    await expect(this.getPage().getByText(appName, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    })
  },
)
