import { request, test as teardown } from '@playwright/test'

/**
 * Global teardown for E2E tests
 *
 * This runs after all tests complete.
 * Cleans up test data created during E2E tests.
 *
 * Environment variables:
 * - NEXT_PUBLIC_API_PREFIX: API URL (default: http://localhost:5001/console/api)
 *
 * Based on Dify API:
 * - GET /apps - list all apps
 * - DELETE /apps/{id} - delete an app
 * - GET /datasets - list all datasets
 * - DELETE /datasets/{id} - delete a dataset
 */

// API base URL with fallback for local development
// Ensure baseURL ends with '/' for proper path concatenation
const API_BASE_URL = (process.env.NEXT_PUBLIC_API_PREFIX || 'http://localhost:5001/console/api').replace(/\/?$/, '/')

// Test data prefixes - used to identify test-created data
// Should match the prefix used in generateTestId()
const TEST_DATA_PREFIXES = ['e2e-', 'test-']

/**
 * Check if a name matches test data pattern
 */
function isTestData(name: string): boolean {
  return TEST_DATA_PREFIXES.some(prefix => name.toLowerCase().startsWith(prefix))
}

/**
 * Delete a single app by ID
 */
async function deleteApp(
  context: Awaited<ReturnType<typeof request.newContext>>,
  app: { id: string, name: string },
): Promise<boolean> {
  try {
    const response = await context.delete(`apps/${app.id}`)
    return response.ok()
  }
  catch {
    console.warn(`   Failed to delete app "${app.name}"`)
    return false
  }
}

/**
 * Delete a single dataset by ID
 */
async function deleteDataset(
  context: Awaited<ReturnType<typeof request.newContext>>,
  dataset: { id: string, name: string },
): Promise<boolean> {
  try {
    const response = await context.delete(`datasets/${dataset.id}`)
    return response.ok()
  }
  catch {
    console.warn(`   Failed to delete dataset "${dataset.name}"`)
    return false
  }
}

teardown('cleanup test data', async () => {
  console.log('🧹 Starting global teardown...')

  const fs = await import('node:fs')
  const authPath = 'e2e/.auth/user.json'

  // Check if auth state file exists and has cookies
  if (!fs.existsSync(authPath)) {
    console.warn('⚠️  Auth state file not found, skipping cleanup')
    console.log('🧹 Global teardown complete.')
    return
  }

  let csrfToken = ''
  try {
    const authState = JSON.parse(fs.readFileSync(authPath, 'utf-8'))
    if (!authState.cookies || authState.cookies.length === 0) {
      console.warn('⚠️  Auth state is empty (no cookies), skipping cleanup')
      console.log('🧹 Global teardown complete.')
      return
    }
    // Extract CSRF token from cookies for API requests
    const csrfCookie = authState.cookies.find((c: { name: string }) => c.name === 'csrf_token')
    csrfToken = csrfCookie?.value || ''
  }
  catch {
    console.warn('⚠️  Failed to read auth state, skipping cleanup')
    console.log('🧹 Global teardown complete.')
    return
  }

  try {
    // Create API request context with auth state and CSRF header
    const context = await request.newContext({
      baseURL: API_BASE_URL,
      storageState: authPath,
      extraHTTPHeaders: {
        'X-CSRF-Token': csrfToken,
      },
    })

    // Clean up test apps
    const appsDeleted = await cleanupTestApps(context)
    console.log(`   📱 Deleted ${appsDeleted} test apps`)

    // Clean up test datasets
    const datasetsDeleted = await cleanupTestDatasets(context)
    console.log(`   📚 Deleted ${datasetsDeleted} test datasets`)

    await context.dispose()
  }
  catch (error) {
    // Don't fail teardown if cleanup fails - just log the error
    console.warn('⚠️  Teardown cleanup encountered errors:', error)
  }

  // Clean up auth state file in CI environment for security
  // In local development, keep it for faster iteration (skip re-login)
  if (process.env.CI) {
    try {
      fs.unlinkSync(authPath)
      console.log('   🔐 Auth state file deleted (CI mode)')
    }
    catch {
      // Ignore if file doesn't exist or can't be deleted
    }
  }

  console.log('🧹 Global teardown complete.')
})

/**
 * Clean up test apps
 * Deletes all apps with names starting with test prefixes
 */
async function cleanupTestApps(context: Awaited<ReturnType<typeof request.newContext>>): Promise<number> {
  try {
    // Fetch all apps - API: GET /apps
    const response = await context.get('apps', {
      params: { page: 1, limit: 100 },
    })

    if (!response.ok()) {
      console.warn('   Failed to fetch apps list:', response.status(), response.url())
      return 0
    }

    const data = await response.json()
    const apps: Array<{ id: string, name: string }> = data.data || []

    // Filter test apps and delete them
    const testApps = apps.filter(app => isTestData(app.name))
    const results = await Promise.all(testApps.map(app => deleteApp(context, app)))

    return results.filter(Boolean).length
  }
  catch (error) {
    console.warn('   Error cleaning up apps:', error)
    return 0
  }
}

/**
 * Clean up test datasets (knowledge bases)
 * Deletes all datasets with names starting with test prefixes
 */
async function cleanupTestDatasets(context: Awaited<ReturnType<typeof request.newContext>>): Promise<number> {
  try {
    // Fetch all datasets - API: GET /datasets
    const response = await context.get('datasets', {
      params: { page: 1, limit: 100 },
    })

    if (!response.ok()) {
      console.warn('   Failed to fetch datasets list:', response.status(), response.url())
      return 0
    }

    const data = await response.json()
    const datasets: Array<{ id: string, name: string }> = data.data || []

    // Filter test datasets and delete them
    const testDatasets = datasets.filter(dataset => isTestData(dataset.name))
    const results = await Promise.all(testDatasets.map(dataset => deleteDataset(context, dataset)))

    return results.filter(Boolean).length
  }
  catch (error) {
    console.warn('   Error cleaning up datasets:', error)
    return 0
  }
}
