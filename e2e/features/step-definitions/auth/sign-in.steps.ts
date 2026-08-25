import type { DifyWorld } from '../../support/world'
import { When } from '@cucumber/cucumber'
import { adminCredentials } from '../../../fixtures/auth'

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

  await page.getByLabel('Email address').fill(adminCredentials.email)
  await page.getByLabel('Password', { exact: true }).fill(adminCredentials.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
})
