import type { DifyWorld } from '../../support/world.ts'
import { When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { adminCredentials } from '../../../fixtures/auth.ts'

When('I open the sign-in page', async function (this: DifyWorld) {
  await this.getPage().goto('/signin')
})

When(
  'I open the sign-in page with redirect target {string}',
  async function (this: DifyWorld, redirectTarget: string) {
    const searchParams = new URLSearchParams({ redirect_url: redirectTarget })

    await this.getPage().goto(`/signin?${searchParams}`)
  },
)

When('I sign in as the default E2E admin', async function (this: DifyWorld) {
  const page = this.getPage()

  const email = page.getByLabel('Email address')
  const password = page.getByLabel('Password', { exact: true })
  const submit = page.getByRole('button', { name: 'Sign in', exact: true })
  await expect(email).toBeVisible({ timeout: 15_000 })
  await expect(password).toBeEditable()
  await email.fill(adminCredentials.email)
  await password.fill(adminCredentials.password)
  await expect(submit).toBeEnabled()
  await submit.click()
})
