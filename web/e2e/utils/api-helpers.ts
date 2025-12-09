import type { APIRequestContext } from '@playwright/test'

/**
 * API helper utilities for test setup and cleanup
 *
 * Use these helpers to set up test data via API before tests run,
 * or to clean up data after tests complete.
 *
 * Environment variables:
 * - NEXT_PUBLIC_API_PREFIX: API URL (default: http://localhost:5001/console/api)
 *
 * Based on Dify API configuration:
 * @see web/config/index.ts - API_PREFIX
 * @see web/types/app.ts - AppModeEnum
 */

// API base URL with fallback for local development
const API_BASE_URL = process.env.NEXT_PUBLIC_API_PREFIX || 'http://localhost:5001/console/api'

/**
 * Dify App mode types
 * @see web/types/app.ts - AppModeEnum
 */
export type AppMode = 'chat' | 'completion' | 'workflow'

/**
 * Create a new app via API
 *
 * @param request - Playwright API request context
 * @param data - App data
 * @param data.name - App name
 * @param data.mode - App mode: chat (Chatbot), completion (Text Generator),
 *                    workflow, advanced-chat (Chatflow), agent-chat (Agent)
 * @param data.description - Optional description
 * @param data.icon - Optional icon
 * @param data.iconBackground - Optional icon background color
 */
export async function createAppViaApi(
  request: APIRequestContext,
  data: {
    name: string
    mode: AppMode
    description?: string
    icon?: string
    iconBackground?: string
  },
): Promise<{ id: string, name: string }> {
  const response = await request.post(`${API_BASE_URL}/apps`, {
    data: {
      name: data.name,
      mode: data.mode,
      description: data.description || '',
      icon: data.icon || 'default',
      icon_background: data.iconBackground || '#FFFFFF',
    },
  })

  if (!response.ok()) {
    const error = await response.text()
    throw new Error(`Failed to create app: ${error}`)
  }

  return response.json()
}

/**
 * Delete an app via API
 */
export async function deleteAppViaApi(
  request: APIRequestContext,
  appId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/apps/${appId}`)

  if (!response.ok() && response.status() !== 404) {
    const error = await response.text()
    throw new Error(`Failed to delete app: ${error}`)
  }
}

/**
 * Create a dataset/knowledge base via API
 */
export async function createDatasetViaApi(
  request: APIRequestContext,
  data: {
    name: string
    description?: string
  },
): Promise<{ id: string, name: string }> {
  const response = await request.post(`${API_BASE_URL}/datasets`, {
    data: {
      name: data.name,
      description: data.description || '',
    },
  })

  if (!response.ok()) {
    const error = await response.text()
    throw new Error(`Failed to create dataset: ${error}`)
  }

  return response.json()
}

/**
 * Delete a dataset via API
 */
export async function deleteDatasetViaApi(
  request: APIRequestContext,
  datasetId: string,
): Promise<void> {
  const response = await request.delete(`${API_BASE_URL}/datasets/${datasetId}`)

  if (!response.ok() && response.status() !== 404) {
    const error = await response.text()
    throw new Error(`Failed to delete dataset: ${error}`)
  }
}

/**
 * Get current user info via API
 */
export async function getCurrentUserViaApi(
  request: APIRequestContext,
): Promise<{ id: string, email: string, name: string }> {
  const response = await request.get(`${API_BASE_URL}/account/profile`)

  if (!response.ok()) {
    const error = await response.text()
    throw new Error(`Failed to get user info: ${error}`)
  }

  return response.json()
}

/**
 * Cleanup helper - delete all test apps by name pattern
 */
export async function cleanupTestApps(
  request: APIRequestContext,
  namePattern: RegExp,
): Promise<number> {
  const response = await request.get(`${API_BASE_URL}/apps`)

  if (!response.ok())
    return 0

  const { data: apps } = await response.json() as { data: Array<{ id: string, name: string }> }

  const testApps = apps.filter(app => namePattern.test(app.name))
  let deletedCount = 0

  for (const app of testApps) {
    try {
      await deleteAppViaApi(request, app.id)
      deletedCount++
    }
    catch {
      // Ignore deletion errors during cleanup
    }
  }

  return deletedCount
}
