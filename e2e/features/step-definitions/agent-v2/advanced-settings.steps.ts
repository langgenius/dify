import type { DifyWorld } from '../../support/world'
import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'

When('I expand Agent v2 Advanced Settings', async function (this: DifyWorld) {
  const page = this.getPage()
  const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })
  const trigger = advancedSettings
    .getByRole('heading', { name: 'Advanced Settings' })
    .getByRole('button')

  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).toBeVisible()
})

When('I collapse Agent v2 Advanced Settings', async function (this: DifyWorld) {
  const page = this.getPage()
  const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })
  const trigger = advancedSettings
    .getByRole('heading', { name: 'Advanced Settings' })
    .getByRole('button')

  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).not.toBeVisible()
})

Then(
  'Agent v2 Advanced Settings should describe supported entries while collapsed',
  async function (this: DifyWorld) {
    const page = this.getPage()
    const advancedSettings = page.getByRole('region', { name: 'Advanced Settings' })

    await expect(advancedSettings).toBeVisible()
    await expect(
      advancedSettings.getByText('For power users. Env vars, sandbox & memory.'),
    ).toBeVisible()
    await expect(advancedSettings.getByRole('heading', { name: 'Env Editor' })).not.toBeVisible()
  },
)

Then(
  'I should see the supported Agent v2 Advanced Settings entries',
  async function (this: DifyWorld) {
    const advancedSettings = this.getPage().getByRole('region', { name: 'Advanced Settings' })
    const envEditor = advancedSettings.getByRole('region', { name: 'Env Editor' })

    await expect(envEditor).toBeVisible()
    await expect(envEditor.getByRole('button', { name: 'Import .env' })).toBeVisible()
    await expect(envEditor.getByRole('button', { name: 'Add environment variable' })).toBeVisible()
    await expect(envEditor.getByText('Key', { exact: true })).toBeVisible()
    await expect(envEditor.getByText('Value', { exact: true })).toBeVisible()
    await expect(envEditor.getByText('Scope', { exact: true })).toBeVisible()
  },
)
