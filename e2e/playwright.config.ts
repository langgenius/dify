import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL || 'http://127.0.0.1:3000'
const apiURL = process.env.E2E_API_URL || 'http://127.0.0.1:5001'

export default defineConfig({
  testDir: './',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  outputDir: './test-results',
  globalSetup: './global.setup.ts',
  use: {
    baseURL,
    locale: 'en-US',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    storageState: './.auth/admin.json',
  },
  webServer: [
    {
      command: 'bash ./scripts/start-api.sh',
      url: `${apiURL}/health`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: 'bash ./scripts/start-web.sh',
      url: baseURL,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
  ],
})
