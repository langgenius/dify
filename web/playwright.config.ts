import path from 'node:path'
import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright Configuration for Dify E2E Tests
 *
 * Environment variables are loaded from web/.env.local
 *
 * E2E specific variables:
 * - E2E_BASE_URL: Base URL for tests (default: http://localhost:3000)
 * - E2E_SKIP_WEB_SERVER: Set to 'true' to skip starting dev server (for CI with deployed env)
 * @see https://playwright.dev/docs/test-configuration
 */

// Load environment variables from web/.env.local
require('dotenv').config({ path: path.resolve(__dirname, '.env.local') })

// Base URL for the frontend application
// - Local development: http://localhost:3000
// - CI/CD with deployed env: set E2E_BASE_URL to the deployed URL
const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3000'

// Whether to skip starting the web server
// - Local development: false (start dev server)
// - CI/CD with deployed env: true (use existing server)
const SKIP_WEB_SERVER = process.env.E2E_SKIP_WEB_SERVER === 'true'

// Cloudflare Access headers (for protected environments).
// Prefer environment variables to avoid hardcoding secrets in repo.
const CF_ACCESS_CLIENT_ID = process.env.CF_ACCESS_CLIENT_ID
const CF_ACCESS_CLIENT_SECRET = process.env.CF_ACCESS_CLIENT_SECRET

const cfAccessHeaders: Record<string, string> = {}
if (CF_ACCESS_CLIENT_ID && CF_ACCESS_CLIENT_SECRET) {
  cfAccessHeaders['CF-Access-Client-Id'] = CF_ACCESS_CLIENT_ID
  cfAccessHeaders['CF-Access-Client-Secret'] = CF_ACCESS_CLIENT_SECRET
}

export default defineConfig({
  // Directory containing test files
  testDir: './e2e/tests',

  // Run tests in files in parallel
  fullyParallel: true,

  // Fail the build on CI if you accidentally left test.only in the source code
  forbidOnly: !!process.env.CI,

  // Retry on CI only
  retries: process.env.CI ? 2 : 0,

  // Opt out of parallel tests on CI for stability
  workers: process.env.CI ? 1 : undefined,

  // Reporter to use
  reporter: process.env.CI
    ? [['html', { open: 'never', outputFolder: 'playwright-report' }], ['github'], ['json', { outputFile: 'e2e/test-results/results.json' }]]
    : [['html', { open: 'on-failure' }], ['list']],

  // Shared settings for all the projects below
  use: {
    // Base URL for all page.goto() calls
    baseURL: BASE_URL,

    // Extra headers for all requests made by the browser context.
    extraHTTPHeaders: cfAccessHeaders,

    // Bypass Content Security Policy to allow test automation
    // This is needed when testing against environments with strict CSP headers
    bypassCSP: true,

    // Collect trace when retrying the failed test
    trace: 'on-first-retry',

    // Take screenshot on failure
    screenshot: 'only-on-failure',

    // Record video on failure
    video: 'on-first-retry',

    // Default timeout for actions
    actionTimeout: 10000,

    // Default timeout for navigation
    navigationTimeout: 30000,
  },

  // Global timeout for each test
  timeout: 60000,

  // Expect timeout
  expect: {
    timeout: 10000,
  },

  // Configure projects for major browsers
  projects: [
    // Setup project - runs before all tests to handle authentication
    {
      name: 'setup',
      testDir: './e2e',
      testMatch: /global\.setup\.ts/,
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testDir: './e2e',
      testMatch: /global\.teardown\.ts/,
    },

    // Main test project - uses authenticated state
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // Use prepared auth state
        storageState: 'e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },

    // Test in Firefox (optional, uncomment when needed)
    // {
    //   name: 'firefox',
    //   use: {
    //     ...devices['Desktop Firefox'],
    //     storageState: 'e2e/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // Test in WebKit (optional, uncomment when needed)
    // {
    //   name: 'webkit',
    //   use: {
    //     ...devices['Desktop Safari'],
    //     storageState: 'e2e/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },

    // Test against mobile viewports (optional)
    // {
    //   name: 'mobile-chrome',
    //   use: {
    //     ...devices['Pixel 5'],
    //     storageState: 'e2e/.auth/user.json',
    //   },
    //   dependencies: ['setup'],
    // },
  ],

  // Output folder for test artifacts
  outputDir: 'e2e/test-results',

  // Run your local dev server before starting the tests
  // - Local: starts dev server automatically
  // - CI with deployed env: set E2E_SKIP_WEB_SERVER=true to skip
  ...(SKIP_WEB_SERVER
    ? {}
    : {
      webServer: {
        command: 'pnpm dev',
        url: BASE_URL,
          // Reuse existing server in local dev, start fresh in CI
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      },
    }),
})
