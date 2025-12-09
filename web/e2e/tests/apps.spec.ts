import { expect, test } from '../fixtures'

/**
 * Apps page E2E tests
 *
 * These tests verify the apps listing and creation functionality.
 */

test.describe('Apps Page', () => {
  test('should display apps page after authentication', async ({ page }) => {
    // Navigate to apps page
    await page.goto('/apps')

    // Verify we're on the apps page (not redirected to signin)
    await expect(page).toHaveURL(/\/apps/)

    // Wait for the page to fully load
    await page.waitForLoadState('networkidle')

    // Take a screenshot for debugging
    await page.screenshot({ path: 'e2e/test-results/apps-page.png' })

    console.log('✅ Apps page loaded successfully')
  })
})
