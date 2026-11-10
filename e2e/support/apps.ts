import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForAppsConsole = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/apps(?:\?.*)?$/, options)
  await expect(page.getByRole('heading', { name: 'Studio' })).toBeVisible(options)
  await expect(page.getByRole('status', { name: 'Loading' })).toBeHidden(options)
}
