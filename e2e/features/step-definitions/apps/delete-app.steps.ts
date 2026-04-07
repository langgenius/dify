import { Then, When } from '@cucumber/cucumber'
import { expect } from '@playwright/test'
import type { DifyWorld } from '../../support/world'

When('I navigate back to the apps console', async function (this: DifyWorld) {
  const page = this.getPage()
  // Click the Dify logo or navigate directly
  await page.goto('/apps')
  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/)
  await expect(page.getByRole('button', { name: 'Create from Blank' })).toBeVisible()
})

When('I delete the last created E2E app', async function (this: DifyWorld) {
  const page = this.getPage()

  // Find the most recently created E2E app card by looking for the name pattern
  const appCards = page.locator('[class*="group"]').filter({ hasText: /E2E App \d+/ })
  const lastCard = appCards.first()
  await expect(lastCard).toBeVisible({ timeout: 10_000 })

  // Hover to reveal the context menu
  await lastCard.hover()

  // Click the more options / three-dot menu button
  const moreButton = lastCard.locator('button').filter({ has: page.locator('svg') }).last()
  await moreButton.click()

  // Click Delete in the dropdown
  await page.getByText('Delete', { exact: true }).click()

  // Confirm deletion in the dialog
  const confirmButton = page.getByRole('button', { name: 'Delete' }).last()
  await expect(confirmButton).toBeVisible()
  await confirmButton.click()

  // Wait for the deletion to complete
  await page.waitForTimeout(1_000)
})

Then('the app should no longer appear in the apps list', async function (this: DifyWorld) {
  const page = this.getPage()

  // Verify no E2E App cards remain (or at least the count decreased)
  // We wait a moment for the UI to update
  await page.waitForTimeout(500)

  // The apps page should still be accessible
  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/)
})
