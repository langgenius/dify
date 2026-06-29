import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { adminCredentials } from '../../../fixtures/auth'

When('I open the account settings page', async function (this: DifyWorld) {
  await this.getPage().goto('/account')
})

Then('I should see the {string} heading', async function (this: DifyWorld, text: string) {
  await expect(this.getPage().getByText(text, { exact: false }).first()).toBeVisible({
    timeout: 30_000,
  })
})

Then('I should see the account email address', async function (this: DifyWorld) {
  await expect(this.getPage().getByText(adminCredentials.email).first()).toBeVisible({
    timeout: 30_000,
  })
})

Then('I should see the name edit button', async function (this: DifyWorld) {
  await expect(this.getPage().getByText('Edit').first()).toBeVisible({ timeout: 30_000 })
})
