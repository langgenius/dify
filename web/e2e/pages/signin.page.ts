import type { Locator, Page } from '@playwright/test'
import { expect } from '@playwright/test'
import { BasePage } from './base.page'

/**
 * Sign In Page Object Model
 *
 * Handles all interactions with the login/sign-in page.
 * Based on: web/app/signin/components/mail-and-password-auth.tsx
 */
export class SignInPage extends BasePage {
  readonly emailInput: Locator
  readonly passwordInput: Locator
  readonly signInButton: Locator
  readonly forgotPasswordLink: Locator
  readonly errorMessage: Locator

  constructor(page: Page) {
    super(page)

    // Selectors based on actual signin page
    // See: web/app/signin/components/mail-and-password-auth.tsx
    this.emailInput = page.locator('#email') // id="email"
    this.passwordInput = page.locator('#password') // id="password"
    this.signInButton = page.getByRole('button', { name: 'Sign in' }) // t('login.signBtn')
    this.forgotPasswordLink = page.getByRole('link', { name: /forgot/i })
    this.errorMessage = page.locator('[class*="toast"]').or(page.getByRole('alert'))
  }

  get path(): string {
    return '/signin'
  }

  /**
   * Fill in email address
   */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email)
  }

  /**
   * Fill in password
   */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password)
  }

  /**
   * Click sign in button
   */
  async clickSignIn(): Promise<void> {
    await this.signInButton.click()
  }

  /**
   * Complete login flow
   */
  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email)
    await this.fillPassword(password)
    await this.clickSignIn()
  }

  /**
   * Login and wait for redirect to dashboard/apps
   */
  async loginAndWaitForRedirect(email: string, password: string): Promise<void> {
    await this.login(email, password)
    // After successful login, Dify redirects to /apps
    await expect(this.page).toHaveURL(/\/apps/, { timeout: 30000 })
  }

  /**
   * Verify invalid credentials error is shown
   * Error message: t('login.error.invalidEmailOrPassword') = "Invalid email or password."
   */
  async expectInvalidCredentialsError(): Promise<void> {
    await expect(this.errorMessage.filter({ hasText: /invalid|incorrect|wrong/i }))
      .toBeVisible({ timeout: 10000 })
  }

  /**
   * Verify email validation error
   * Error message: t('login.error.emailInValid') = "Please enter a valid email address"
   */
  async expectEmailValidationError(): Promise<void> {
    await expect(this.errorMessage.filter({ hasText: /valid email/i }))
      .toBeVisible({ timeout: 10000 })
  }

  /**
   * Verify password empty error
   * Error message: t('login.error.passwordEmpty') = "Password is required"
   */
  async expectPasswordEmptyError(): Promise<void> {
    await expect(this.errorMessage.filter({ hasText: /password.*required/i }))
      .toBeVisible({ timeout: 10000 })
  }

  /**
   * Check if user is already logged in (auto-redirected)
   */
  async isRedirectedToApps(timeout = 5000): Promise<boolean> {
    try {
      await this.page.waitForURL(/\/apps/, { timeout })
      return true
    }
    catch {
      return false
    }
  }
}
