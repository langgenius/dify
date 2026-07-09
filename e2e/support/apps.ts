import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) =>
  timeout === undefined ? undefined : { timeout }

export const waitForAppsConsole = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/, options)
  await expect(page.getByRole('heading', { name: 'Studio' })).toBeVisible(
    options,
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

  await page.getByRole('button', { name: 'Create', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Create from Blank' }).click()
}
