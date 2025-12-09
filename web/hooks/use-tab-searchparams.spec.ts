/**
 * Test suite for useTabSearchParams hook
 *
 * This hook manages tab state through URL search parameters, enabling:
 * - Bookmarkable tab states (users can share URLs with specific tabs active)
 * - Browser history integration (back/forward buttons work with tabs)
 * - Configurable routing behavior (push vs replace)
 * - Optional search parameter syncing (can disable URL updates)
 *
 * The hook syncs a local tab state with URL search parameters, making tab
 * navigation persistent and shareable across sessions.
 */
import { act, renderHook } from '@testing-library/react'
import { useTabSearchParams } from './use-tab-searchparams'

// Mock Next.js navigation hooks
const mockPush = jest.fn()
const mockReplace = jest.fn()
const mockPathname = '/test-path'
const mockSearchParams = new URLSearchParams()

jest.mock('next/navigation', () => ({
  usePathname: jest.fn(() => mockPathname),
  useRouter: jest.fn(() => ({
    push: mockPush,
    replace: mockReplace,
  })),
  useSearchParams: jest.fn(() => mockSearchParams),
}))

// Import after mocks
import { usePathname } from 'next/navigation'

describe('useTabSearchParams', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSearchParams.delete('category')
    mockSearchParams.delete('tab')
  })

  describe('Basic functionality', () => {
    /**
     * Test that the hook returns a tuple with activeTab and setActiveTab
     * This is the primary interface matching React's useState pattern
     */
    it('should return activeTab and setActiveTab function', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      const [activeTab, setActiveTab] = result.current

      expect(typeof activeTab).toBe('string')
      expect(typeof setActiveTab).toBe('function')
    })

    /**
     * Test that the hook initializes with the default tab
     * When no search param is present, should use defaultTab
     */
    it('should initialize with default tab when no search param exists', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      const [activeTab] = result.current
      expect(activeTab).toBe('overview')
    })

    /**
     * Test that the hook reads from URL search parameters
     * When a search param exists, it should take precedence over defaultTab
     */
    it('should initialize with search param value when present', () => {
      mockSearchParams.set('category', 'settings')

      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      const [activeTab] = result.current
      expect(activeTab).toBe('settings')
    })

    /**
     * Test that setActiveTab updates the local state
     * The active tab should change when setActiveTab is called
     */
    it('should update active tab when setActiveTab is called', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      const [activeTab] = result.current
      expect(activeTab).toBe('settings')
    })
  })

  describe('Routing behavior', () => {
    /**
     * Test default push routing behavior
     * By default, tab changes should use router.push (adds to history)
     */
    it('should use push routing by default', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      expect(mockPush).toHaveBeenCalledWith('/test-path?category=settings', { scroll: false })
      expect(mockReplace).not.toHaveBeenCalled()
    })

    /**
     * Test replace routing behavior
     * When routingBehavior is 'replace', should use router.replace (no history)
     */
    it('should use replace routing when specified', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          routingBehavior: 'replace',
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      expect(mockReplace).toHaveBeenCalledWith('/test-path?category=settings', { scroll: false })
      expect(mockPush).not.toHaveBeenCalled()
    })

    /**
     * Test that URL encoding is applied to tab values
     * Special characters in tab names should be properly encoded
     */
    it('should encode special characters in tab values', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings & config')
      })

      expect(mockPush).toHaveBeenCalledWith(
        '/test-path?category=settings%20%26%20config',
        { scroll: false },
      )
    })

    /**
     * Test that URL decoding is applied when reading from search params
     * Encoded values in the URL should be properly decoded
     */
    it('should decode encoded values from search params', () => {
      mockSearchParams.set('category', 'settings%20%26%20config')

      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      const [activeTab] = result.current
      expect(activeTab).toBe('settings & config')
    })
  })

  describe('Custom search parameter name', () => {
    /**
     * Test using a custom search parameter name
     * Should support different param names instead of default 'category'
     */
    it('should use custom search param name', () => {
      mockSearchParams.set('tab', 'profile')

      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          searchParamName: 'tab',
        }),
      )

      const [activeTab] = result.current
      expect(activeTab).toBe('profile')
    })

    /**
     * Test that setActiveTab uses the custom param name in the URL
     */
    it('should update URL with custom param name', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          searchParamName: 'tab',
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('profile')
      })

      expect(mockPush).toHaveBeenCalledWith('/test-path?tab=profile', { scroll: false })
    })
  })

  describe('Disabled search params mode', () => {
    /**
     * Test that disableSearchParams prevents URL updates
     * When disabled, tab state should be local only
     */
    it('should not update URL when disableSearchParams is true', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          disableSearchParams: true,
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      expect(mockPush).not.toHaveBeenCalled()
      expect(mockReplace).not.toHaveBeenCalled()
    })

    /**
     * Test that local state still updates when search params are disabled
     * The tab state should work even without URL syncing
     */
    it('should still update local state when search params disabled', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          disableSearchParams: true,
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      const [activeTab] = result.current
      expect(activeTab).toBe('settings')
    })

    /**
     * Test that disabled mode always uses defaultTab
     * Search params should be ignored when disabled
     */
    it('should use defaultTab when search params disabled even if URL has value', () => {
      mockSearchParams.set('category', 'settings')

      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          disableSearchParams: true,
        }),
      )

      const [activeTab] = result.current
      expect(activeTab).toBe('overview')
    })
  })

  describe('Edge cases', () => {
    /**
     * Test handling of empty string tab values
     * Empty strings should be handled gracefully
     */
    it('should handle empty string tab values', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('')
      })

      const [activeTab] = result.current
      expect(activeTab).toBe('')
      expect(mockPush).toHaveBeenCalledWith('/test-path?category=', { scroll: false })
    })

    /**
     * Test that special characters in tab names are properly encoded
     * This ensures URLs remain valid even with unusual tab names
     */
    it('should handle tabs with various special characters', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      // Test tab with slashes
      act(() => result.current[1]('tab/with/slashes'))
      expect(result.current[0]).toBe('tab/with/slashes')

      // Test tab with question marks
      act(() => result.current[1]('tab?with?questions'))
      expect(result.current[0]).toBe('tab?with?questions')

      // Test tab with hash symbols
      act(() => result.current[1]('tab#with#hash'))
      expect(result.current[0]).toBe('tab#with#hash')

      // Test tab with equals signs
      act(() => result.current[1]('tab=with=equals'))
      expect(result.current[0]).toBe('tab=with=equals')
    })

    /**
     * Test fallback when pathname is not available
     * Should use window.location.pathname as fallback
     */
    it('should fallback to window.location.pathname when hook pathname is null', () => {
      ;(usePathname as jest.Mock).mockReturnValue(null)

      // Mock window.location.pathname
      Object.defineProperty(window, 'location', {
        value: { pathname: '/fallback-path' },
        writable: true,
      })

      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      expect(mockPush).toHaveBeenCalledWith('/fallback-path?category=settings', { scroll: false })

      // Restore mock
      ;(usePathname as jest.Mock).mockReturnValue(mockPathname)
    })
  })

  describe('Multiple instances', () => {
    /**
     * Test that multiple instances with different param names work independently
     * Different hooks should not interfere with each other
     */
    it('should support multiple independent tab states', () => {
      mockSearchParams.set('category', 'overview')
      mockSearchParams.set('subtab', 'details')

      const { result: result1 } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'home',
          searchParamName: 'category',
        }),
      )

      const { result: result2 } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'info',
          searchParamName: 'subtab',
        }),
      )

      const [activeTab1] = result1.current
      const [activeTab2] = result2.current

      expect(activeTab1).toBe('overview')
      expect(activeTab2).toBe('details')
    })
  })

  describe('Integration scenarios', () => {
    /**
     * Test typical usage in a tabbed interface
     * Simulates real-world tab switching behavior
     */
    it('should handle sequential tab changes', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      // Change to settings tab
      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('settings')
      })

      expect(result.current[0]).toBe('settings')
      expect(mockPush).toHaveBeenCalledWith('/test-path?category=settings', { scroll: false })

      // Change to profile tab
      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('profile')
      })

      expect(result.current[0]).toBe('profile')
      expect(mockPush).toHaveBeenCalledWith('/test-path?category=profile', { scroll: false })

      // Verify push was called twice
      expect(mockPush).toHaveBeenCalledTimes(2)
    })

    /**
     * Test that the hook works with complex pathnames
     * Should handle nested routes and existing query params
     */
    it('should work with complex pathnames', () => {
      ;(usePathname as jest.Mock).mockReturnValue('/app/123/settings')

      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('advanced')
      })

      expect(mockPush).toHaveBeenCalledWith('/app/123/settings?category=advanced', { scroll: false })

      // Restore mock
      ;(usePathname as jest.Mock).mockReturnValue(mockPathname)
    })
  })

  describe('Type safety', () => {
    /**
     * Test that the return type is a const tuple
     * TypeScript should infer [string, (tab: string) => void] as const
     */
    it('should return a const tuple type', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      // The result should be a tuple with exactly 2 elements
      expect(result.current).toHaveLength(2)
      expect(typeof result.current[0]).toBe('string')
      expect(typeof result.current[1]).toBe('function')
    })
  })

  describe('Performance', () => {
    /**
     * Test that the hook creates a new function on each render
     * Note: The current implementation doesn't use useCallback,
     * so setActiveTab is recreated on each render. This could lead to
     * unnecessary re-renders in child components that depend on this function.
     * TODO: Consider memoizing setActiveTab with useCallback for better performance.
     */
    it('should create new setActiveTab function on each render', () => {
      const { result, rerender } = renderHook(() =>
        useTabSearchParams({ defaultTab: 'overview' }),
      )

      const [, firstSetActiveTab] = result.current
      rerender()
      const [, secondSetActiveTab] = result.current

      // Function reference changes on re-render (not memoized)
      expect(firstSetActiveTab).not.toBe(secondSetActiveTab)

      // But both functions should work correctly
      expect(typeof firstSetActiveTab).toBe('function')
      expect(typeof secondSetActiveTab).toBe('function')
    })
  })

  describe('Browser history integration', () => {
    /**
     * Test that push behavior adds to browser history
     * This enables back/forward navigation through tabs
     */
    it('should add to history with push behavior', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          routingBehavior: 'push',
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('tab1')
      })

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('tab2')
      })

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('tab3')
      })

      // Each tab change should create a history entry
      expect(mockPush).toHaveBeenCalledTimes(3)
    })

    /**
     * Test that replace behavior doesn't add to history
     * This prevents cluttering browser history with tab changes
     */
    it('should not add to history with replace behavior', () => {
      const { result } = renderHook(() =>
        useTabSearchParams({
          defaultTab: 'overview',
          routingBehavior: 'replace',
        }),
      )

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('tab1')
      })

      act(() => {
        const [, setActiveTab] = result.current
        setActiveTab('tab2')
      })

      // Should use replace instead of push
      expect(mockReplace).toHaveBeenCalledTimes(2)
      expect(mockPush).not.toHaveBeenCalled()
    })
  })
})
