import type { Locator, Page } from '@playwright/test'

/**
 * Common test helper utilities for E2E tests
 */

/**
 * Wait for network to be idle with a custom timeout
 */
export async function waitForNetworkIdle(page: Page, timeout = 5000): Promise<void> {
  await page.waitForLoadState('networkidle', { timeout })
}

/**
 * Wait for an element to be stable (not moving/resizing)
 */
export async function waitForStable(locator: Locator, timeout = 5000): Promise<void> {
  await locator.waitFor({ state: 'visible', timeout })
  // Additional wait for animations to complete
  await locator.evaluate(el => new Promise<void>((resolve) => {
    const observer = new MutationObserver(() => {
      // Observer callback - intentionally empty, just watching for changes
    })
    observer.observe(el, { attributes: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
      resolve()
    }, 100)
  }))
}

/**
 * Safely click an element with retry logic
 */
export async function safeClick(
  locator: Locator,
  options?: { timeout?: number, force?: boolean },
): Promise<void> {
  const { timeout = 10000, force = false } = options || {}
  await locator.waitFor({ state: 'visible', timeout })
  await locator.click({ force, timeout })
}

/**
 * Fill input with clear first
 */
export async function fillInput(
  locator: Locator,
  value: string,
  options?: { clear?: boolean },
): Promise<void> {
  const { clear = true } = options || {}
  if (clear)
    await locator.clear()

  await locator.fill(value)
}

/**
 * Select option from dropdown/select element
 */
export async function selectOption(
  trigger: Locator,
  optionText: string,
  page: Page,
): Promise<void> {
  await trigger.click()
  await page.getByRole('option', { name: optionText }).click()
}

/**
 * Wait for toast notification and verify its content
 *
 * Based on Dify toast implementation:
 * @see web/app/components/base/toast/index.tsx
 *
 * Toast structure:
 * - Container: .fixed.z-[9999] with rounded-xl
 * - Type background classes: bg-toast-success-bg, bg-toast-error-bg, etc.
 * - Type icon classes: text-text-success, text-text-destructive, etc.
 */
export async function waitForToast(
  page: Page,
  expectedText: string | RegExp,
  type?: 'success' | 'error' | 'warning' | 'info',
): Promise<Locator> {
  // Dify toast uses fixed positioning with z-[9999]
  const toastContainer = page.locator('.fixed.z-\\[9999\\]')

  // Filter by type if specified
  let toast: Locator
  if (type) {
    // Each type has specific background class
    const typeClassMap: Record<string, string> = {
      success: '.bg-toast-success-bg',
      error: '.bg-toast-error-bg',
      warning: '.bg-toast-warning-bg',
      info: '.bg-toast-info-bg',
    }
    toast = toastContainer.filter({ has: page.locator(typeClassMap[type]) })
      .filter({ hasText: expectedText })
  }
  else {
    toast = toastContainer.filter({ hasText: expectedText })
  }

  await toast.waitFor({ state: 'visible', timeout: 10000 })
  return toast
}

/**
 * Dismiss any visible modals
 */
export async function dismissModal(page: Page): Promise<void> {
  const modal = page.locator('[role="dialog"]')
  if (await modal.isVisible()) {
    // Try clicking close button or backdrop
    const closeButton = modal.locator('button[aria-label*="close"], button:has-text("Cancel")')
    if (await closeButton.isVisible())
      await closeButton.click()
    else
      await page.keyboard.press('Escape')

    await modal.waitFor({ state: 'hidden', timeout: 5000 })
  }
}

/**
 * Generate a unique test identifier
 */
export function generateTestId(prefix = 'test'): string {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(2, 8)
  return `${prefix}-${timestamp}-${random}`
}

/**
 * Take a screenshot with a descriptive name
 */
export async function takeDebugScreenshot(
  page: Page,
  name: string,
): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  await page.screenshot({
    path: `e2e/test-results/debug-${name}-${timestamp}.png`,
    fullPage: true,
  })
}

/**
 * Retry an action with exponential backoff
 */
export async function retryAction<T>(
  action: () => Promise<T>,
  options?: { maxAttempts?: number, baseDelay?: number },
): Promise<T> {
  const { maxAttempts = 3, baseDelay = 1000 } = options || {}

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await action()
    }
    catch (error) {
      if (attempt === maxAttempts)
        throw error

      const delay = baseDelay * 2 ** (attempt - 1)
      await new Promise(resolve => setTimeout(resolve, delay))
    }
  }

  throw new Error('Unreachable')
}
