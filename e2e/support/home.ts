import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForConsoleHome = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect.poll(() => new URL(page.url()).pathname, options).toBe('/')
  await expect(page.getByRole('link', { name: 'Home' })).toHaveAttribute(
    'aria-current',
    'page',
    options,
  )
}
