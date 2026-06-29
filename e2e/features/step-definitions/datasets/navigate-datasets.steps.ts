import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I open the datasets page', async function (this: DifyWorld) {
  await this.getPage().goto('/datasets')
})

Then('I should stay on the datasets page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/datasets(?:\?.*)?$/)
})

Then('I should see the {string} link', async function (this: DifyWorld, label: string) {
  await expect(this.getPage().getByText(label)).toBeVisible({ timeout: 30_000 })
})

When('I click the {string} link', async function (this: DifyWorld, label: string) {
  await this.getPage().getByText(label).click()
})

Then('I should be on the dataset creation page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/datasets\/create(?:\?.*)?$/, { timeout: 30_000 })
})
