import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForAgentsConsole = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/agents(?:\?.*)?$/, options)
  await expect(page.getByRole('link', { name: 'Agents', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
    options,
  )
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible(options)

  const roster = page.getByRole('region', { name: 'Agent list' })
  await expect(roster).toBeVisible(options)
  await expect(roster).not.toHaveAttribute('aria-busy', 'true', options)
}
