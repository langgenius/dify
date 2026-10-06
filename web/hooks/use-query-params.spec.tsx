import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { usePluginInstallation } from './use-query-params'

const renderWithAdapter = <T,>(hook: () => T, searchParams = '') => {
  return renderHookWithNuqs(hook, { searchParams })
}

// Query param hooks: defaults, parsing, and URL sync behavior.
describe('useQueryParams hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
