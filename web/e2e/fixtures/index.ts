import { test as base, expect } from '@playwright/test'
import { AppsPage } from '../pages/apps.page'
import { SignInPage } from '../pages/signin.page'
import { WorkflowPage } from '../pages/workflow.page'

/**
 * Extended test fixtures for Dify E2E tests
 *
 * This module provides custom fixtures that inject page objects
 * into tests, making it easier to write maintainable tests.
 *
 * @example
 * ```typescript
 * import { test, expect } from '@/e2e/fixtures'
 *
 * test('can create new app', async ({ appsPage }) => {
 *   await appsPage.goto()
 *   await appsPage.createApp('My Test App')
 *   await expect(appsPage.appCard('My Test App')).toBeVisible()
 * })
 * ```
 */

// Define custom fixtures type
type DifyFixtures = {
  appsPage: AppsPage
  signInPage: SignInPage
  workflowPage: WorkflowPage
}

/**
 * Extended test object with Dify-specific fixtures
 */
export const test = base.extend<DifyFixtures>({
  // Apps page fixture
  appsPage: async ({ page }, run) => {
    const appsPage = new AppsPage(page)
    await run(appsPage)
  },

  // Sign in page fixture
  signInPage: async ({ page }, run) => {
    const signInPage = new SignInPage(page)
    await run(signInPage)
  },

  // Workflow page fixture
  workflowPage: async ({ page }, run) => {
    const workflowPage = new WorkflowPage(page)
    await run(workflowPage)
  },
})

// Re-export expect for convenience
export { expect }
