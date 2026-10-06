import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForConsoleHome = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/(?:\?.*)?$/, options)
  await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
    options,
  )
  await expect(page.getByRole('heading', { name: 'Templates', exact: true })).toBeVisible(options)
}
