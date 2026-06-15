import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export const waitForAppsConsole = async (page: Page, timeout?: number) => {
  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/, timeout === undefined ? undefined : { timeout })
  await expect(page.getByRole('heading', { name: 'Studio' })).toBeVisible(
    timeout === undefined ? undefined : { timeout },
  )
}

export const openBlankAppCreation = async (page: Page) => {
  const createFromBlankButton = page.getByRole('button', { name: 'Create from Blank' }).first()
  const isDirectCreateVisible = await createFromBlankButton
    .isVisible({ timeout: 3_000 })
    .catch(() => false)

  if (isDirectCreateVisible) {
    await createFromBlankButton.click()
    return
  }

  await page.getByRole('button', { name: 'Create' }).click()
  await page.getByRole('menuitem', { name: 'Create from Blank' }).click()
}
