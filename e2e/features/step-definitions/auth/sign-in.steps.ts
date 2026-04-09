import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I open the sign-in page', async function (this: DifyWorld) {
  await this.getPage().goto('/signin')
  await expect(this.getPage().getByRole('button', { name: /^Sign in$/i })).toBeVisible({
    timeout: 30_000,
  })
})

When('I enter invalid credentials', async function (this: DifyWorld) {
  const page = this.getPage()

  await page.getByLabel('Email address').fill('wrong@example.com')
  await page.getByLabel('Password').fill('WrongPassword123')
})

When('I click the sign-in button', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: /^Sign in$/i }).click()
})

Then('I should see a sign-in error message', async function (this: DifyWorld) {
  await expect(this.getPage().getByText(/Invalid email or password/i)).toBeVisible({
    timeout: 30_000,
  })
})
