import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function waitForAgentConfigureAutosaved(page: Page) {
  await expect(
    page.getByText(/^Saved(?:\s|$)/).filter({ visible: true }).first(),
  ).toBeVisible({ timeout: 30_000 })
}
