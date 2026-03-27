import { expect, test } from '@playwright/test'

test('opens the apps console with the shared authenticated state', async ({ page }) => {
  await page.goto('/apps')

  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).not.toBeVisible()
})
