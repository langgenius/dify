import { act, renderHook } from '@testing-library/react'
import {
  useInvalidDataSourceAuth,
  useInvalidDataSourceListAuth,
  useInvalidDefaultDataSourceListAuth,
} from '@/service/use-datasource'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import { useDataSourceAuthUpdate } from './use-data-source-auth-update'

/**
 * useDataSourceAuthUpdate Hook Tests
 * This hook manages the invalidation of various data source related queries.
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
  const mockInvalidateDataSourceAuth = vi.fn()
  const mockInvalidateDataSourceListAuth = vi.fn()
  const mockInvalidDefaultDataSourceListAuth = vi.fn()
  const mockInvalidateDataSourceList = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()

    vi.mocked(useInvalidDataSourceAuth).mockReturnValue(mockInvalidateDataSourceAuth)
    vi.mocked(useInvalidDataSourceListAuth).mockReturnValue(mockInvalidateDataSourceListAuth)
    vi.mocked(useInvalidDefaultDataSourceListAuth).mockReturnValue(mockInvalidDefaultDataSourceListAuth)
    vi.mocked(useInvalidDataSourceList).mockReturnValue(mockInvalidateDataSourceList)
  })

  describe('handleAuthUpdate', () => {
    it('should call all invalidate functions when handleAuthUpdate is invoked', () => {
      // Arrange
      const pluginId = 'test-plugin-id'
      const provider = 'test-provider'
      const { result } = renderHook(() => useDataSourceAuthUpdate({
        pluginId,
        provider,
      }))

      // Assert Initialization
      expect(useInvalidDataSourceAuth).toHaveBeenCalledWith({ pluginId, provider })

      // Act
      act(() => {
        result.current.handleAuthUpdate()
      })

      // Assert Invalidation
      expect(mockInvalidateDataSourceListAuth).toHaveBeenCalledTimes(1)
      expect(mockInvalidDefaultDataSourceListAuth).toHaveBeenCalledTimes(1)
      expect(mockInvalidateDataSourceList).toHaveBeenCalledTimes(1)
      expect(mockInvalidateDataSourceAuth).toHaveBeenCalledTimes(1)
    })

    it('should maintain stable handleAuthUpdate reference if dependencies do not change', () => {
      // Arrange
      const props = {
        pluginId: 'stable-plugin',
        provider: 'stable-provider',
      }
      const { result, rerender } = renderHook(
        ({ pluginId, provider }) => useDataSourceAuthUpdate({ pluginId, provider }),
        { initialProps: props },
      )
      const firstHandleAuthUpdate = result.current.handleAuthUpdate

      // Act
      rerender(props)

      // Assert
      expect(result.current.handleAuthUpdate).toBe(firstHandleAuthUpdate)
    })
  })
})
