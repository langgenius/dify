import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { adminCredentials } from '../../../fixtures/auth'

When('I open the sign-in page', async function (this: DifyWorld) {
  await this.getPage().goto('/signin')
})

When('I sign in as the default E2E admin', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Password').fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
})

Then('I should be on the apps console', async function (this: DifyWorld) {
  await expect(this.getPage()).toHaveURL(/\/apps(?:\?.*)?$/, { timeout: 30_000 })
})
