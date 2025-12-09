import { expect, test as setup } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const authFile = path.join(__dirname, '.auth/user.json')

/**
 * Global setup for E2E tests
 *
 * This runs before all tests and handles authentication.
 * The authenticated state is saved and reused across all tests.
 *
 * Based on signin implementation:
 * - web/app/signin/components/mail-and-password-auth.tsx
 */
setup('authenticate', async ({ page }) => {
  // Get test user credentials from environment
  const email = process.env.NEXT_PUBLIC_E2E_USER_EMAIL
  const password = process.env.NEXT_PUBLIC_E2E_USER_PASSWORD

  if (!email || !password) {
    console.warn(
      '⚠️  NEXT_PUBLIC_E2E_USER_EMAIL or NEXT_PUBLIC_E2E_USER_PASSWORD not set.',
      'Creating empty auth state. Tests requiring auth will fail.',
    )
    // Create empty auth state directory if it doesn't exist
    const authDir = path.dirname(authFile)
    if (!fs.existsSync(authDir))
      fs.mkdirSync(authDir, { recursive: true })

    // Save empty state
    await page.context().storageState({ path: authFile })
    return
  }

  // Navigate to login page
  await page.goto('/signin')

  // Wait for the page to load
  await page.waitForLoadState('networkidle')

  // Fill in login form using actual Dify selectors
  // Email input has id="email"
  await page.locator('#email').fill(email)
  // Password input has id="password"
  await page.locator('#password').fill(password)

  // Wait for button to be enabled (form validation passes)
  const signInButton = page.getByRole('button', { name: 'Sign in' })
  await expect(signInButton).toBeEnabled({ timeout: 5000 })

  // Click login button and wait for the login API response
  const [response] = await Promise.all([
    page.waitForResponse(resp =>
      resp.url().includes('/login') && resp.request().method() === 'POST',
    ),
    signInButton.click(),
  ])

  // Check if login request was successful
  const status = response.status()
  if (status === 200) {
    // Redirect response means login successful (server-side redirect)
    console.log('✅ Login successful (redirect response)')
    // Wait for navigation to complete (redirect to /apps)
    // See: mail-and-password-auth.tsx line 71 - router.replace(redirectUrl || '/apps')
    await expect(page).toHaveURL(/\/apps/, { timeout: 30000 })
  }
  else {
    // Other status codes indicate failure
    throw new Error(`Login request failed with status ${status}`)
  }

  // Save authenticated state
  await page.context().storageState({ path: authFile })

  console.log('✅ Authentication successful, state saved.')
})
