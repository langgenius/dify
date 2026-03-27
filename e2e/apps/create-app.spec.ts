import { expect, test } from '@playwright/test'

test('creates a new blank app and redirects to the editor', async ({ page }) => {
  const appName = `E2E App ${Date.now()}`

  await page.goto('/apps')

  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
  await page.getByRole('button', { name: 'Create from Blank' }).click()

  await page.getByPlaceholder('Give your app a name').fill(appName)

  const createButton = page.getByRole('button', { name: /^Create(?:\s|$)/ }).last()
  await expect(createButton).toBeEnabled()
  await createButton.click()

  await expect(page).toHaveURL(/\/app\/[^/]+\/(workflow|configuration)(?:\?.*)?$/)
  await expect(page.getByText('Orchestrate')).toBeVisible({ timeout: 30_000 })
})
