import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

const getExpectOptions = (timeout?: number) => (timeout === undefined ? undefined : { timeout })

export const waitForModelProviderIntegrations = async (page: Page, timeout?: number) => {
  const options = getExpectOptions(timeout)

  await expect(page).toHaveURL(/\/integrations\/model-provider(?:\?.*)?$/, options)
  await expect(page.getByRole('link', { name: 'Integrations', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
    options,
  )
  await expect(page.getByRole('region', { name: 'Model Provider' })).toBeVisible(options)
}
