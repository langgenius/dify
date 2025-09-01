import { expect, test } from '@playwright/test'
import AllMethodsDisabled from './__mocks__/system-features/all-methods-disabled'

test.describe('Login Flow', () => {
  test('has title', async ({ page }) => {
    await page.route('**/console/api/system-features', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(AllMethodsDisabled),
      })
    })

    await page.goto('/signin')

    await expect(page).toHaveTitle('Dify')
    await expect(page.getByText('Authentication method not configured')).toBeVisible()
  })
})
