import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { openBlankAppCreation } from '../../../support/apps'
import { createE2EResourceName } from '../../../support/naming'

When('I start creating a blank app', async function (this: DifyWorld) {
  await openBlankAppCreation(this.getPage())
})

When('I enter a unique E2E app name', async function (this: DifyWorld) {
  const appName = createE2EResourceName('App')
  this.lastCreatedAppName = appName
  await this.getPage().getByPlaceholder('Give your app a name').fill(appName)
})

When('I confirm app creation', async function (this: DifyWorld) {
  const createButton = this.getPage()
    .getByRole('dialog')
    .getByRole('button', { name: /^Create(?:\s|$)/ })

  await expect(createButton).toBeEnabled()
  await createButton.click()
})

When('I select the {string} app type', async function (this: DifyWorld, appType: string) {
  const dialog = this.getPage().getByRole('dialog')
  const appTypeCard = dialog.getByRole('button', {
    name: new RegExp(`^${appType.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`),
  })

  await expect(appTypeCard).toBeVisible()
  await appTypeCard.click()
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
