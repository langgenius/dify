import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { waitForAppsConsole } from '../../../support/apps'

When('I open the apps console', async function (this: DifyWorld) {
  await this.getPage().goto('/apps')
})

When('I refresh the current page', async function (this: DifyWorld) {
  await this.getPage().reload()
})

Then('I should stay on the apps console', async function (this: DifyWorld) {
  await waitForAppsConsole(this.getPage())
})

Then('I should be redirected to the signin page', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/signin(?:\?.*)?$/)
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
