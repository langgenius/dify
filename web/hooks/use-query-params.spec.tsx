import { act, waitFor } from '@testing-library/react'
import { renderHookWithNuqs } from '@/test/nuqs-testing'
import { usePluginInstallation } from './use-query-params'

const renderWithAdapter = <T,>(hook: () => T, searchParams = '') => {
  return renderHookWithNuqs(hook, { searchParams })
}

// Query param hooks: defaults, parsing, and URL sync behavior.
describe('useQueryParams hooks', () => {
  // Plugin installation query behavior.
  describe('usePluginInstallation', () => {
    it('should parse package ids from JSON arrays', () => {
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result } = renderWithAdapter(
        () => usePluginInstallation(),
        `?package-ids=%5B%22org%2Fplugin%22%5D&bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      const [state] = result.current

      expect(state.packageId).toBe('org/plugin')
      expect(state.bundleInfo).toEqual(bundleInfo)
    })

    it('should return raw package id when JSON parsing fails', () => {
      const { result } = renderWithAdapter(() => usePluginInstallation(), '?package-ids=org/plugin')

      const [state] = result.current

      expect(state.packageId).toBe('org/plugin')
    })

    it('should return raw package id when JSON is not an array', () => {
      const { result } = renderWithAdapter(
        () => usePluginInstallation(),
        '?package-ids=%22org%2Fplugin%22',
      )

      const [state] = result.current

      expect(state.packageId).toBe('"org/plugin"')
    })

    it('writes package and bundle info together while preserving unrelated URL parameters', async () => {
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePluginInstallation(),
        '?tab=installed',
      )
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }

      act(() => {
        result.current[1]({ packageId: 'org/plugin', bundleInfo })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get('package-ids')).toBe('["org/plugin"]')
      expect(update.searchParams.get('bundle-info')).toBe(JSON.stringify(bundleInfo))
      expect(update.searchParams.get('tab')).toBe('installed')
    })

    it('should clear installation params when state is null', async () => {
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePluginInstallation(),
        `?package-ids=%5B%22org%2Fplugin%22%5D&bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      act(() => {
        result.current[1](null)
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.has('package-ids')).toBe(false)
      expect(update.searchParams.has('bundle-info')).toBe(false)
    })

    it('should preserve bundle info when only packageId is updated', async () => {
      const bundleInfo = { org: 'org', name: 'bundle', version: '1.0.0' }
      const { result, onUrlUpdate } = renderWithAdapter(
        () => usePluginInstallation(),
        `?bundle-info=${encodeURIComponent(JSON.stringify(bundleInfo))}`,
      )

      act(() => {
        result.current[1]({ packageId: 'org/plugin' })
      })

      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1]![0]
      expect(update.searchParams.get('bundle-info')).toBe(JSON.stringify(bundleInfo))
    })
  })
})
