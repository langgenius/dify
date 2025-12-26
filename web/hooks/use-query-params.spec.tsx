import type { UrlUpdateEvent } from 'nuqs/adapters/testing'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { ACCOUNT_SETTING_MODAL_ACTION } from '@/app/components/header/account-setting/constants'
import {
  clearQueryParams,
  PRICING_MODAL_QUERY_PARAM,
  PRICING_MODAL_QUERY_VALUE,
  useAccountSettingModal,
  useMarketplaceFilters,
  usePluginInstallation,
  usePricingModal,
} from './use-query-params'

const renderWithAdapter = <T,>(hook: () => T, searchParams = '') => {
  const onUrlUpdate = vi.fn<(event: UrlUpdateEvent) => void>()
  const wrapper = ({ children }: { children: ReactNode }) => (
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      {children}
    </NuqsTestingAdapter>
  )
  const { result } = renderHook(hook, { wrapper })
  return { result, onUrlUpdate }
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('replace')
    })
  })

  // Account settings modal query behavior.
  describe('useAccountSettingModal', () => {
    it('should return closed state with null payload when query params are missing', () => {
      // Arrange
      const { result } = renderWithAdapter(() => useAccountSettingModal())

      // Act
      const [state] = result.current

      // Assert
      expect(state.isOpen).toBe(false)
      expect(state.payload).toBeNull()
    })

    it('should return open state when action matches', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => useAccountSettingModal(),
        `?action=${ACCOUNT_SETTING_MODAL_ACTION}&tab=billing`,
      )

      // Act
      const [state] = result.current

      // Assert
      expect(state.isOpen).toBe(true)
      expect(state.payload).toBe('billing')
    })

    it('should return closed state when action does not match', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => useAccountSettingModal(),
        '?action=other&tab=billing',
      )

      // Act
      const [state] = result.current

      // Assert
      expect(state.isOpen).toBe(false)
      expect(state.payload).toBeNull()
    })

    it('should set action and tab when opening', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => useAccountSettingModal())

      // Act
      act(() => {
        result.current[1]({ payload: 'members' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('action')).toBe(ACCOUNT_SETTING_MODAL_ACTION)
      expect(update.searchParams.get('tab')).toBe('members')
    })

    it('should use push history when opening from closed state', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => useAccountSettingModal())

      // Act
      act(() => {
        result.current[1]({ payload: 'members' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('push')
    })

    it('should update tab when switching while open', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useAccountSettingModal(),
        `?action=${ACCOUNT_SETTING_MODAL_ACTION}&tab=billing`,
      )

      // Act
      act(() => {
        result.current[1]({ payload: 'provider' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('tab')).toBe('provider')
    })

    it('should use replace history when switching tabs while open', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useAccountSettingModal(),
        `?action=${ACCOUNT_SETTING_MODAL_ACTION}&tab=billing`,
      )

      // Act
      act(() => {
        result.current[1]({ payload: 'provider' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('replace')
    })

    it('should clear action and tab when closing', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useAccountSettingModal(),
        `?action=${ACCOUNT_SETTING_MODAL_ACTION}&tab=billing`,
      )

      // Act
      act(() => {
        result.current[1](null)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('action')).toBe(false)
      expect(update.searchParams.has('tab')).toBe(false)
    })

    it('should use replace history when closing', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useAccountSettingModal(),
        `?action=${ACCOUNT_SETTING_MODAL_ACTION}&tab=billing`,
      )

      // Act
      act(() => {
        result.current[1](null)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.options.history).toBe('replace')
    })
  })

  // Marketplace filters query behavior.
  describe('useMarketplaceFilters', () => {
    it('should return default filters when query params are missing', () => {
      // Arrange
      const { result } = renderWithAdapter(() => useMarketplaceFilters())

      // Act
      const [filters] = result.current

      // Assert
      expect(filters.q).toBe('')
      expect(filters.category).toBe('all')
      expect(filters.tags).toEqual([])
    })

    it('should parse filters when query params are present', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?q=prompt&category=tool&tags=ai,ml',
      )

      // Act
      const [filters] = result.current

      // Assert
      expect(filters.q).toBe('prompt')
      expect(filters.category).toBe('tool')
      expect(filters.tags).toEqual(['ai', 'ml'])
    })

    it('should treat empty tags param as empty array', () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?tags=',
      )

      // Act
      const [filters] = result.current

      // Assert
      expect(filters.tags).toEqual([])
    })

    it('should preserve other filters when updating a single field', async () => {
      // Arrange
      const { result } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?category=tool&tags=ai,ml',
      )

      // Act
      act(() => {
        result.current[1]({ q: 'search' })
      })

      // Assert
      await waitFor(() => expect(result.current[0].q).toBe('search'))
      expect(result.current[0].category).toBe('tool')
      expect(result.current[0].tags).toEqual(['ai', 'ml'])
    })

    it('should clear q param when q is empty', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?q=search',
      )

      // Act
      act(() => {
        result.current[1]({ q: '' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('q')).toBe(false)
    })

    it('should serialize tags as comma-separated values', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => useMarketplaceFilters())

      // Act
      act(() => {
        result.current[1]({ tags: ['ai', 'ml'] })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('tags')).toBe('ai,ml')
    })

    it('should remove tags param when list is empty', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?tags=ai,ml',
      )

      // Act
      act(() => {
        result.current[1]({ tags: [] })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('tags')).toBe(false)
    })

    it('should keep category in the URL when set to default', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?category=tool',
      )

      // Act
      act(() => {
        result.current[1]({ category: 'all' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('category')).toBe('all')
    })

    it('should clear all marketplace filters when set to null', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(
        () => useMarketplaceFilters(),
        '?q=search&category=tool&tags=ai,ml',
      )

      // Act
      act(() => {
        result.current[1](null)
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.has('q')).toBe(false)
      expect(update.searchParams.has('category')).toBe(false)
      expect(update.searchParams.has('tags')).toBe(false)
    })

    it('should use replace history when updating filters', async () => {
      // Arrange
      const { result, onUrlUpdate } = renderWithAdapter(() => useMarketplaceFilters())

      // Act
      act(() => {
        result.current[1]({ q: 'search' })
      })

      // Assert
      await waitFor(() => expect(onUrlUpdate).toHaveBeenCalled())
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const { result } = renderWithAdapter(
        () => usePluginInstallation(),
        '?package-ids=org/plugin',
      )

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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
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
      const update = onUrlUpdate.mock.calls[onUrlUpdate.mock.calls.length - 1][0]
      expect(update.searchParams.get('bundle-info')).toBe(JSON.stringify(bundleInfo))
    })
  })
})

// Utility to clear query params from the current URL.
describe('clearQueryParams', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.history.replaceState(null, '', '/')
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should remove a single key when provided one key', () => {
    // Arrange
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    window.history.pushState(null, '', '/?foo=1&bar=2')

    // Act
    clearQueryParams('foo')

    // Assert
    expect(replaceSpy).toHaveBeenCalled()
    const params = new URLSearchParams(window.location.search)
    expect(params.has('foo')).toBe(false)
    expect(params.get('bar')).toBe('2')
    replaceSpy.mockRestore()
  })

  it('should remove multiple keys when provided an array', () => {
    // Arrange
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    window.history.pushState(null, '', '/?foo=1&bar=2&baz=3')

    // Act
    clearQueryParams(['foo', 'baz'])

    // Assert
    expect(replaceSpy).toHaveBeenCalled()
    const params = new URLSearchParams(window.location.search)
    expect(params.has('foo')).toBe(false)
    expect(params.has('baz')).toBe(false)
    expect(params.get('bar')).toBe('2')
    replaceSpy.mockRestore()
  })

  it('should no-op when window is undefined', () => {
    // Arrange
    const replaceSpy = vi.spyOn(window.history, 'replaceState')
    vi.stubGlobal('window', undefined)

    // Act
    expect(() => clearQueryParams('foo')).not.toThrow()

    // Assert
    expect(replaceSpy).not.toHaveBeenCalled()
    replaceSpy.mockRestore()
  })
})
