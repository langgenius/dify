import type { DifyWorld } from '../../support/world'
import { Given, Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import { createTestApp } from '../../../support/api'

Given(
  'there is an existing E2E completion app available for testing',
  async function (this: DifyWorld) {
    const name = `E2E Test App ${Date.now()}`
    const app = await createTestApp(name, 'completion')
    this.lastCreatedAppName = app.name
    this.createdAppIds.push(app.id)
  },
)

When('I confirm the app switch', async function (this: DifyWorld) {
  await this.getPage().getByRole('button', { name: 'Start switch' }).click()
})

Then('I should land on the switched app', async function (this: DifyWorld) {
  const page = this.getPage()
  await expect(page).toHaveURL(/\/app\/[^/]+\/workflow(?:\?.*)?$/, { timeout: 15_000 })

  // Capture the new app's ID so the After hook can clean it up
  const match = page.url().match(/\/app\/([^/]+)\/workflow/)
  if (match?.[1])
    this.createdAppIds.push(match[1])
})
