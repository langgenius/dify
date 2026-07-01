import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function waitForAgentConfigureAutosaved(page: Page) {
  await expect(page.getByText(/^Saved(?:\s|$)/).first()).toBeVisible({ timeout: 30_000 })
}
