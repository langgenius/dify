import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Base Page Object Model class
 *
 * All page objects should extend this class.
 * Provides common functionality and patterns for page objects.
 */
export abstract class BasePage {
  readonly page: Page

  // Common elements that exist across multiple pages
  protected readonly loadingSpinner: Locator

  constructor(page: Page) {
    this.page = page

    // Loading spinner - based on web/app/components/base/loading/index.tsx
    // Uses SVG with .spin-animation class
    this.loadingSpinner = page.locator('.spin-animation')
  }

  /**
   * Abstract method - each page must define its URL path
   */
  abstract get path(): string

  /**
   * Navigate to this page
   */
  async goto(): Promise<void> {
    await this.page.goto(this.path)
    await this.waitForPageLoad()
  }

  /**
   * Wait for page to finish loading
   */
  async waitForPageLoad(): Promise<void> {
    await this.page.waitForLoadState('networkidle')
    // Wait for any loading spinners to disappear
    if (await this.loadingSpinner.isVisible())
      await this.loadingSpinner.waitFor({ state: 'hidden', timeout: 30000 })
  }

  /**
   * Check if page is currently visible
   */
  async isVisible(): Promise<boolean> {
    return this.page.url().includes(this.path)
  }

  /**
   * Wait for and verify a toast notification
   * Toast text is in .system-sm-semibold class
   */
  async expectToast(text: string | RegExp): Promise<void> {
    const toast = this.page.locator('.system-sm-semibold').filter({ hasText: text })
    await expect(toast).toBeVisible({ timeout: 10000 })
  }

  /**
   * Wait for a successful operation toast
   * Success toast has bg-toast-success-bg background and RiCheckboxCircleFill icon
   */
  async expectSuccessToast(text?: string | RegExp): Promise<void> {
    // Success toast contains .text-text-success class (green checkmark icon)
    const successIndicator = this.page.locator('.text-text-success')
    await expect(successIndicator).toBeVisible({ timeout: 10000 })

    if (text) {
      const toastText = this.page.locator('.system-sm-semibold').filter({ hasText: text })
      await expect(toastText).toBeVisible({ timeout: 10000 })
    }
  }

  /**
   * Wait for an error toast
   * Error toast has bg-toast-error-bg background and RiErrorWarningFill icon
   */
  async expectErrorToast(text?: string | RegExp): Promise<void> {
    // Error toast contains .text-text-destructive class (red warning icon)
    const errorIndicator = this.page.locator('.text-text-destructive')
    await expect(errorIndicator).toBeVisible({ timeout: 10000 })

    if (text) {
      const toastText = this.page.locator('.system-sm-semibold').filter({ hasText: text })
      await expect(toastText).toBeVisible({ timeout: 10000 })
    }
  }

  /**
   * Wait for a warning toast
   * Warning toast has bg-toast-warning-bg background
   */
  async expectWarningToast(text?: string | RegExp): Promise<void> {
    const warningIndicator = this.page.locator('.text-text-warning-secondary')
    await expect(warningIndicator).toBeVisible({ timeout: 10000 })

    if (text) {
      const toastText = this.page.locator('.system-sm-semibold').filter({ hasText: text })
      await expect(toastText).toBeVisible({ timeout: 10000 })
    }
  }

  /**
   * Get the current page title
   */
  async getTitle(): Promise<string> {
    return this.page.title()
  }

  /**
   * Take a screenshot of the current page
   */
  async screenshot(name: string): Promise<void> {
    await this.page.screenshot({
      path: `e2e/test-results/screenshots/${name}.png`,
      fullPage: true,
    })
  }

  /**
   * Wait for navigation to complete
   */
  async waitForNavigation(options?: { timeout?: number }): Promise<void> {
    await this.page.waitForLoadState('networkidle', options)
  }

  /**
   * Press keyboard shortcut
   */
  async pressShortcut(shortcut: string): Promise<void> {
    await this.page.keyboard.press(shortcut)
  }

  /**
   * Get element by test id (data-testid attribute)
   */
  getByTestId(testId: string): Locator {
    return this.page.getByTestId(testId)
  }
}
