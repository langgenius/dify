import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForKnowledgeConsole = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/datasets(?:\?.*)?$/, options)
  await expect(page.getByRole('link', { name: 'Knowledge', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
    options,
  )
  await expect(page.getByRole('heading', { name: 'Knowledge', exact: true })).toBeVisible(options)
  await expect(page.getByRole('status', { name: 'Loading' })).toBeHidden(options)
}
