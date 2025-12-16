import { expect, test as setup } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const authFile = path.join(__dirname, '.auth/user.json')

/**
 * Supported authentication methods for E2E tests
 * - password: Email + Password login (default, recommended)
 *
 * OAuth (GitHub/Google) and SSO are not supported in E2E tests
 * as they require third-party authentication which cannot be reliably automated.
 */

/**
 * Global setup for E2E tests
 *
 * This runs before all tests and handles authentication.
 * The authenticated state is saved and reused across all tests.
 *
 * Environment variables:
 * - NEXT_PUBLIC_E2E_USER_EMAIL: Test user email (required)
 * - NEXT_PUBLIC_E2E_USER_PASSWORD: Test user password (required for 'password' method)
 */
setup('authenticate', async ({ page }) => {
  const email = process.env.NEXT_PUBLIC_E2E_USER_EMAIL
  const password = process.env.NEXT_PUBLIC_E2E_USER_PASSWORD

  // Validate required credentials based on auth method
  if (!email) {
    console.warn(
      '⚠️  NEXT_PUBLIC_E2E_USER_EMAIL not set.',
      'Creating empty auth state. Tests requiring auth will fail.',
    )
    await saveEmptyAuthState(page)
    return
  }

  if (!password) {
    console.warn(
      '⚠️  NEXT_PUBLIC_E2E_USER_PASSWORD not set for password auth method.',
      'Creating empty auth state. Tests requiring auth will fail.',
    )
    await saveEmptyAuthState(page)
    return
  }

  // Navigate to login page
  await page.goto('/signin')
  await page.waitForLoadState('networkidle')

  // Execute login
  await loginWithPassword(page, email, password!)

  // Wait for successful redirect to /apps
  await expect(page).toHaveURL(/\/apps/, { timeout: 30000 })

  // Save authenticated state
  await page.context().storageState({ path: authFile })
  console.log('✅ Authentication successful, state saved.')
})

/**
 * Save empty auth state when credentials are not available
 */
async function saveEmptyAuthState(page: import('@playwright/test').Page): Promise<void> {
  const authDir = path.dirname(authFile)
  if (!fs.existsSync(authDir))
    fs.mkdirSync(authDir, { recursive: true })
  await page.context().storageState({ path: authFile })
}

/**
 * Login using email and password
 * Based on: web/app/signin/components/mail-and-password-auth.tsx
 */
async function loginWithPassword(
  page: import('@playwright/test').Page,
  email: string,
  password: string,
): Promise<void> {
  console.log('📧 Logging in with email and password...')

  // Fill in login form
  // Email input has id="email"
  await page.locator('#email').fill(email)
  // Password input has id="password"
  await page.locator('#password').fill(password)

  // Wait for button to be enabled (form validation passes)
  const signInButton = page.getByRole('button', { name: /sign in/i })
  await expect(signInButton).toBeEnabled({ timeout: 5000 })

  // Click login button and wait for navigation or API response
  // The app uses ky library which follows redirects automatically
  // Some environments may have WAF/CDN that adds extra redirects
  // So we use a more flexible approach: wait for either URL change or API response
  const responsePromise = page.waitForResponse(
    resp => resp.url().includes('login') && resp.request().method() === 'POST',
    { timeout: 15000 },
  ).catch(() => null) // Don't fail if we can't catch the response

  await signInButton.click()

  // Try to get the response, but don't fail if we can't
  const response = await responsePromise
  if (response) {
    const status = response.status()
    console.log(`📡 Login API response status: ${status}`)
    // 200 = success, 302 = redirect (some WAF/CDN setups)
    if (status !== 200 && status !== 302) {
      // Try to get error details
      try {
        const body = await response.json()
        console.error('❌ Login failed:', body)
      }
      catch {
        console.error(`❌ Login failed with status ${status}`)
      }
    }
  }
  else {
    console.log('⚠️ Could not capture login API response, will verify via URL redirect')
  }

  console.log('✅ Password login request sent')
}
