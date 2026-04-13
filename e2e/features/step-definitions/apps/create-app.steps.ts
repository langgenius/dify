import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I start creating a blank app', async function (this: DifyWorld) {
  const page = this.getPage()

  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
  await page.getByRole('button', { name: 'Create from Blank' }).click()
})

When('I enter a unique E2E app name', async function (this: DifyWorld) {
  const appName = `E2E App ${Date.now()}`

  await this.getPage().getByPlaceholder('Give your app a name').fill(appName)
})

When('I confirm app creation', async function (this: DifyWorld) {
  const createButton = this.getPage()
    .getByRole('button', { name: /^Create(?:\s|$)/ })
    .last()

  await expect(createButton).toBeEnabled()
  await createButton.click()
})

When('I select the {string} app type', async function (this: DifyWorld, appType: string) {
  const dialog = this.getPage().getByRole('dialog')
  const appTypeTitle = dialog.getByText(appType, { exact: true })

  await expect(appTypeTitle).toBeVisible()
  await appTypeTitle.click()
})

When('I expand the beginner app types', async function (this: DifyWorld) {
  const page = this.getPage()
  const toggle = page.getByRole('button', { name: 'More basic app types' })

  await expect(toggle).toBeVisible()
  await toggle.click()
})

Then('I should land on the app editor', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/(workflow|configuration)(?:\?.*)?$/)
})

Then('I should land on the workflow editor', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/workflow(?:\?.*)?$/)
})

Then('I should land on the app configuration page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/app\/[^/]+\/configuration(?:\?.*)?$/)
})
