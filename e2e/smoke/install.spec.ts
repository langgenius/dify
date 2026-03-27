import { expect, test } from '@playwright/test'
import { readAuthSessionMetadata } from '../fixtures/auth'

test('completes the initial installation bootstrap on a fresh instance', async ({ page }) => {
  const session = await readAuthSessionMetadata()

  test.skip(session.mode !== 'install', 'This smoke test requires a fresh, uninitialized instance.')

  await page.goto('/apps')

  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
})
