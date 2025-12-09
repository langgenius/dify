# E2E Testing Guide

This directory contains End-to-End (E2E) tests for the Dify web application using [Playwright](https://playwright.dev/).

## Quick Start

### 1. Setup

```bash
# Install dependencies (if not already done)
pnpm install

# Install Playwright browsers
pnpm exec playwright install chromium
```

### 2. Configure Environment (Optional)

Add E2E test configuration to your `web/.env.local` file:

```env
# E2E Test Configuration
# Base URL of the frontend (optional, defaults to http://localhost:3000)
E2E_BASE_URL=https://test.example.com

# Skip starting dev server (use existing deployed server)
E2E_SKIP_WEB_SERVER=true

# API URL (optional, defaults to http://localhost:5001/console/api)
NEXT_PUBLIC_API_PREFIX=http://localhost:5001/console/api
```

### 3. Run Tests

```bash
# Run all E2E tests
pnpm test:e2e

# Run tests with UI (interactive mode)
pnpm test:e2e:ui

# Run tests with browser visible
pnpm test:e2e:headed

# Run tests in debug mode
pnpm test:e2e:debug

# View test report
pnpm test:e2e:report
```

## Project Structure

```
web/
├── .env.local          # Environment config (includes E2E variables)
├── playwright.config.ts # Playwright configuration
└── e2e/
    ├── fixtures/           # Test fixtures (extended test objects)
    │   └── index.ts       # Main fixtures with page objects
    ├── pages/             # Page Object Models (POM)
    │   ├── base.page.ts   # Base class for all page objects
    │   ├── signin.page.ts # Sign-in page interactions
    │   ├── apps.page.ts   # Apps listing page interactions
    │   ├── workflow.page.ts # Workflow editor interactions
    │   └── index.ts       # Page objects export
    ├── tests/             # Test files (*.spec.ts)
    ├── utils/             # Test utilities
    │   ├── index.ts       # Utils export
    │   ├── test-helpers.ts # Common helper functions
    │   └── api-helpers.ts  # API-level test helpers
    ├── .auth/             # Authentication state (gitignored)
    ├── global.setup.ts    # Authentication setup
    ├── global.teardown.ts # Cleanup after tests
    └── README.md          # This file
```

## Writing Tests

### Using Page Objects

```typescript
import { test, expect } from '../fixtures'

test('create a new app', async ({ appsPage }) => {
  await appsPage.goto()
  await appsPage.createApp({
    name: 'My Test App',
    type: 'chatbot',
  })
  await appsPage.expectAppExists('My Test App')
})
```

### Using Test Helpers

```typescript
import { test, expect } from '../fixtures'
import { generateTestId, waitForNetworkIdle } from '../utils/test-helpers'

test('search functionality', async ({ appsPage }) => {
  const uniqueName = generateTestId('app')
  // ... test logic
})
```

### Test Data Cleanup

Always clean up test data to avoid polluting the database:

```typescript
test('create and delete app', async ({ appsPage }) => {
  const appName = generateTestId('test-app')
  
  // Create
  await appsPage.createApp({ name: appName, type: 'chatbot' })
  
  // Test assertions
  await appsPage.expectAppExists(appName)
  
  // Cleanup
  await appsPage.deleteApp(appName)
})
```

### Skipping Authentication

For tests that need to verify unauthenticated behavior:

```typescript
test.describe('unauthenticated tests', () => {
  test.use({ storageState: { cookies: [], origins: [] } })
  
  test('redirects to login', async ({ page }) => {
    await page.goto('/apps')
    await expect(page).toHaveURL(/\/signin/)
  })
})
```

## Best Practices

### 1. Use Page Object Model (POM)

- Encapsulate page interactions in page objects
- Makes tests more readable and maintainable
- Changes to selectors only need to be updated in one place

### 2. Use Meaningful Test Names

```typescript
// Good
test('should display error message for invalid email format', ...)

// Bad  
test('test1', ...)
```

### 3. Use Data-TestId Attributes

When adding elements to the application, use `data-testid` attributes:

```tsx
// In React component
<button data-testid="create-app-button">Create App</button>

// In test
await page.getByTestId('create-app-button').click()
```

### 4. Generate Unique Test Data

```typescript
import { generateTestId } from '../utils/test-helpers'

const appName = generateTestId('my-app') // e.g., "my-app-1732567890123-abc123"
```

### 5. Handle Async Operations

```typescript
// Wait for element
await expect(element).toBeVisible({ timeout: 10000 })

// Wait for navigation
await page.waitForURL(/\/apps/)

// Wait for network
await page.waitForLoadState('networkidle')
```

## Creating New Page Objects

1. Create a new file in `e2e/pages/`:

```typescript
// e2e/pages/my-feature.page.ts
import type { Page, Locator } from '@playwright/test'
import { BasePage } from './base.page'

export class MyFeaturePage extends BasePage {
  readonly myElement: Locator
  
  constructor(page: Page) {
    super(page)
    this.myElement = page.getByTestId('my-element')
  }
  
  get path(): string {
    return '/my-feature'
  }
  
  async doSomething(): Promise<void> {
    await this.myElement.click()
  }
}
```

2. Export from `e2e/pages/index.ts`:

```typescript
export { MyFeaturePage } from './my-feature.page'
```

3. Add to fixtures in `e2e/fixtures/index.ts`:

```typescript
import { MyFeaturePage } from '../pages/my-feature.page'

type DifyFixtures = {
  // ... existing fixtures
  myFeaturePage: MyFeaturePage
}

export const test = base.extend<DifyFixtures>({
  // ... existing fixtures
  myFeaturePage: async ({ page }, use) => {
    await use(new MyFeaturePage(page))
  },
})
```

## Debugging

### Visual Debugging

```bash
# Open Playwright UI
pnpm test:e2e:ui

# Run with visible browser
pnpm test:e2e:headed

# Debug mode with inspector
pnpm test:e2e:debug
```

### Traces and Screenshots

Failed tests automatically capture:
- Screenshots
- Video recordings
- Trace files

View them:
```bash
pnpm test:e2e:report
```

### Manual Trace Viewing

```bash
pnpm exec playwright show-trace e2e/test-results/path-to-trace.zip
```

## Troubleshooting

### Tests timeout waiting for elements

1. Check if selectors are correct
2. Increase timeout: `{ timeout: 30000 }`
3. Add explicit waits: `await page.waitForSelector(...)`

### Authentication issues

1. Make sure global.setup.ts has completed successfully
2. For deployed environments, ensure E2E_BASE_URL matches your cookie domain
3. Clear auth state: `rm -rf e2e/.auth/`

### Flaky tests

1. Add explicit waits for async operations
2. Use `test.slow()` for inherently slow tests
3. Add retry logic for unstable operations

## Resources

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Page Object Model Pattern](https://playwright.dev/docs/pom)
- [Best Practices](https://playwright.dev/docs/best-practices)
- [Debugging Guide](https://playwright.dev/docs/debug)

