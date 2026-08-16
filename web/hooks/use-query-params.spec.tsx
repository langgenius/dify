import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import {
  PRICING_MODAL_QUERY_PARAM,
  PRICING_MODAL_QUERY_VALUE,
  usePluginInstallation,
  usePricingModal,
} from './use-query-params'

const renderWithAdapter = <T,>(hook: () => T, searchParams = '') => {
  return renderHookWithNuqs(hook, { searchParams })
}

// Query param hooks: defaults, parsing, and URL sync behavior.
describe('useQueryParams hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Pricing modal query behavior.
  describe('usePricingModal', () => {
    it('should return closed state when query param is missing', () => {
      // Arrange
      const { result } = renderWithAdapter(() => usePricingModal())

      // Act
      const [isOpen] = result.current

      // Assert
      expect(isOpen).toBe(false)
    })

    it('should return open state when query param matches open value', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => usePricingModal(),
        `?${PRICING_MODAL_QUERY_PARAM}=${PRICING_MODAL_QUERY_VALUE}`,
      )

      // Act
      const [isOpen] = result.current

      // Assert
      expect(isOpen).toBe(true)
    })

    it('should return closed state when query param has unexpected value', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => usePricingModal(),
        `?${PRICING_MODAL_QUERY_PARAM}=closed`,
      )

      // Act
      const [isOpen] = result.current

      // Assert
      expect(isOpen).toBe(false)
    })

    it('should set pricing param when opening', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => usePricingModal())

      // Act
      act(() => {
        result.current[1](true)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get(PRICING_MODAL_QUERY_PARAM)).toBe(PRICING_MODAL_QUERY_VALUE)
    })

    it('should use push history when opening', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => usePricingModal())

      // Act
      act(() => {
        result.current[1](true)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.options.history).toBe('push')
    })

    it('should clear pricing param when closing', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePricingModal(),
        `?${PRICING_MODAL_QUERY_PARAM}=${PRICING_MODAL_QUERY_VALUE}`,
      )

      // Act
      act(() => {
        result.current[1](false)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.has(PRICING_MODAL_QUERY_PARAM)).toBe(false)
    })

    it('should use push history when closing', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePricingModal(),
        `?${PRICING_MODAL_QUERY_PARAM}=${PRICING_MODAL_QUERY_VALUE}`,
      )

      // Act
      act(() => {
        result.current[1](false)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.options.history).toBe('push')
    })

    it('should respect explicit history options when provided', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => usePricingModal())

      // Act
      act(() => {
        result.current[1](true, { history: 'replace' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.options.history).toBe('replace')
    })
  })

  // Plugin installation query behavior.
  describe('usePluginInstallation', () => {
    it('should parse package ids from JSON arrays', () => {
      // Arrange
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result } = renderWithAdapter(
        () => usePluginInstallation(),
        `?package-ids=%5B%22org%2Fplugin%22%5D&bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      // Act
      const [state] = result.current

      // Assert
      expect(state.packageId).toBe('org/plugin')
      expect(state.bundleInfo).toEqual(bundleInfo)
    })

    it('should return raw package id when JSON parsing fails', () => {
      // Arrange
      const { result } = renderWithAdapter(() => usePluginInstallation(), '?package-ids=org/plugin')

      // Act
      const [state] = result.current

      // Assert
      expect(state.packageId).toBe('org/plugin')
    })

    it('should return raw package id when JSON is not an array', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => usePluginInstallation(),
        '?package-ids=%22org%2Fplugin%22',
      )

      // Act
      const [state] = result.current

      // Assert
      expect(state.packageId).toBe('"org/plugin"')
    })

    it('should write package ids as JSON arrays when setting packageId', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => usePluginInstallation())

      // Act
      act(() => {
        result.current[1]({ packageId: 'org/plugin' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get('package-ids')).toBe('["org/plugin"]')
    })

    it('should set bundle info when provided', async () => {
      // Arrange
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result, onUrlUpdate } = renderWithAdapter(() => usePluginInstallation())

      // Act
      act(() => {
        result.current[1]({ bundleInfo })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get('bundle-info')).toBe(JSON.stringify(bundleInfo))
    })

    it('should clear installation params when state is null', async () => {
      // Arrange
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePluginInstallation(),
        `?package-ids=%5B%22org%2Fplugin%22%5D&bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      // Act
      act(() => {
        result.current[1](null)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.has('package-ids')).toBe(false)
      expect(update.searchParams.has('bundle-info')).toBe(false)
    })

    it('should preserve bundle info when only packageId is updated', async () => {
      // Arrange
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePluginInstallation(),
        `?bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      // Act
      act(() => {
        result.current[1]({ packageId: 'org/plugin' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get('bundle-info')).toBe(JSON.stringify(bundleInfo))
    })
  })
})
