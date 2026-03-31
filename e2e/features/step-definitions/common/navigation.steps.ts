import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I open the apps console', async function (this: DifyWorld) {
  await this.getPage().goto('/apps')
})

Then('I should stay on the apps console', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/apps(?:\?.*)?$/)
})

Then('I should see the {string} button', async function (this: DifyWorld, label: string) {
  await expect(this.getPage().getByRole('button', { name: label })).toBeVisible()
})

Then('I should not see the {string} button', async function (this: DifyWorld, label: string) {
  await expect(this.getPage().getByRole('button', { name: label })).not.toBeVisible()
})

Then('I should see the {string} text', async function (this: DifyWorld, text: string) {
  await expect(this.getPage().getByText(text)).toBeVisible({ timeout: 30_000 })
})
