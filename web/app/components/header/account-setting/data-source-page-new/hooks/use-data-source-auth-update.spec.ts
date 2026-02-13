import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useInvalidDataSourceAuth,
  useInvalidDataSourceListAuth,
  useInvalidDefaultDataSourceListAuth,
} from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import { useDataSourceAuthUpdate } from './use-data-source-auth-update'

/**
 * Mocking internal service hooks.
 * We use vi.mock to intercept calls to these service functions.
 */
vi.mock('@/service/use-datasource', () => ({
  useInvalidDataSourceAuth: vi.fn(),
  useInvalidDataSourceListAuth: vi.fn(),
  useInvalidDefaultDataSourceListAuth: vi.fn(),
}))

vi.mock('@/service/use-pipeline', () => ({
  useInvalidDataSourceList: vi.fn(),
}))

describe('useDataSourceAuthUpdate', () => {
  // Define mock implementation functions that will be returned by the service hooks
  const mockInvalidateDataSourceAuth = vi.fn()
  const mockInvalidateDataSourceListAuth = vi.fn()
  const mockInvalidDefaultDataSourceListAuth = vi.fn()
  const mockInvalidateDataSourceList = vi.fn()

  beforeEach(() => {
    // Reset all mocks before each test to ensure test isolation
    vi.clearAllMocks()

    // Setup the service hooks to return our mock functions
    vi.mocked(useInvalidDataSourceAuth).mockReturnValue(mockInvalidateDataSourceAuth)
    vi.mocked(useInvalidDataSourceListAuth).mockReturnValue(mockInvalidateDataSourceListAuth)
    vi.mocked(useInvalidDefaultDataSourceListAuth).mockReturnValue(mockInvalidDefaultDataSourceListAuth)
    vi.mocked(useInvalidDataSourceList).mockReturnValue(mockInvalidateDataSourceList)
  })

  it('should call all invalidate functions when handleAuthUpdate is invoked', () => {
    const pluginId = 'test-plugin-id'
    const provider = 'test-provider'

    // Render the hook with test parameters
    const { result } = renderHook(() => useDataSourceAuthUpdate({
      pluginId,
      provider,
    }))

    // Verify that the invalidation hooks were initialized correctly
    expect(useInvalidDataSourceAuth).toHaveBeenCalledWith({ pluginId, provider })

    // Execute the handleAuthUpdate callback
    act(() => {
      result.current.handleAuthUpdate()
    })

    // Assert that all invalidation functions were called exactly once
    expect(mockInvalidateDataSourceListAuth).toHaveBeenCalledTimes(1)
    expect(mockInvalidDefaultDataSourceListAuth).toHaveBeenCalledTimes(1)
    expect(mockInvalidateDataSourceList).toHaveBeenCalledTimes(1)
    expect(mockInvalidateDataSourceAuth).toHaveBeenCalledTimes(1)
  })

  it('should maintain stable handleAuthUpdate reference if dependencies do not change', () => {
    const props = {
      pluginId: 'stable-plugin',
      provider: 'stable-provider',
    }

    const { result, rerender } = renderHook(
      ({ pluginId, provider }) => useDataSourceAuthUpdate({ pluginId, provider }),
      { initialProps: props },
    )

    const firstHandleAuthUpdate = result.current.handleAuthUpdate

    // Rerender with the same props
    rerender(props)

    // Check if the reference remained stable
    expect(result.current.handleAuthUpdate).toBe(firstHandleAuthUpdate)
  })
})
