/**
 * Test suite for useBreakpoints hook
 *
 * This hook provides responsive breakpoint detection based on window width.
 * It listens to window resize events and returns the current media type.
 *
 * Breakpoint definitions:
 * - mobile: width <= 640px
 * - tablet: 640px < width <= 768px
 * - pc: width > 768px
 *
 * The hook automatically updates when the window is resized and cleans up
 * event listeners on unmount to prevent memory leaks.
 */
import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import useBreakpoints, { MediaType } from './use-breakpoints'

describe('useBreakpoints', () => {
  const originalInnerWidth = window.innerWidth

  /**
   * Helper function to simulate window resize events
   * Updates window.innerWidth and dispatches a resize event
   */
  const fireResize = (width: number) => {
    window.innerWidth = width
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  /**
   * Restore the original innerWidth after all tests
   * Ensures tests don't affect each other or the test environment
   */
  afterAll(() => {
    window.innerWidth = originalInnerWidth
  })

  it('should hydrate server markup on mobile without rebuilding it', async () => {
    const ResponsiveContent = () => {
      const media = useBreakpoints()
      return createElement(media === MediaType.mobile ? 'nav' : 'aside', null, media)
    }
    const container = document.createElement('div')
    const onRecoverableError = vi.fn()

    // The server has no viewport. Its markup must also be the first client render.
    vi.stubGlobal('innerWidth', undefined)
    try {
      container.innerHTML = renderToString(createElement(ResponsiveContent))
    } finally {
      vi.unstubAllGlobals()
    }
    window.innerWidth = 390

    const root = hydrateRoot(container, createElement(ResponsiveContent), { onRecoverableError })
    try {
      await act(async () => {})
      expect(onRecoverableError).not.toHaveBeenCalled()
      expect(container).toHaveTextContent(MediaType.mobile)

      fireResize(1024)
      expect(container).toHaveTextContent(MediaType.pc)
    } finally {
      act(() => root.unmount())
    }
  })

  /**
   * Test mobile breakpoint detection
   * Mobile devices have width <= 640px
   */
  it('should return mobile for width <= 640px', () => {
    // Mock window.innerWidth for mobile
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 640,
    })

    const { result } = renderHook(() => useBreakpoints())
    expect(result.current).toBe(MediaType.mobile)
  })

  /**
   * Test tablet breakpoint detection
   * Tablet devices have width between 640px and 768px
   */
  it('should return tablet for width > 640px and <= 768px', () => {
    // Mock window.innerWidth for tablet
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 768,
    })

    const { result } = renderHook(() => useBreakpoints())
    expect(result.current).toBe(MediaType.tablet)
  })

  /**
   * Test desktop/PC breakpoint detection
   * Desktop devices have width > 768px
   */
  it('should return pc for width > 768px', () => {
    // Mock window.innerWidth for pc
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    })

    const { result } = renderHook(() => useBreakpoints())
    expect(result.current).toBe(MediaType.pc)
  })

  /**
   * Test dynamic breakpoint updates on window resize
   * The hook should react to window resize events and update the media type
   */
  it('should update media type when window resizes', () => {
    // Start with desktop
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    })

    const { result } = renderHook(() => useBreakpoints())
    expect(result.current).toBe(MediaType.pc)

    // Resize to tablet
    fireResize(768)
    expect(result.current).toBe(MediaType.tablet)

    // Resize to mobile
    fireResize(600)
    expect(result.current).toBe(MediaType.mobile)
  })

  /**
   * Test proper cleanup of event listeners
   * Ensures no memory leaks by removing resize listeners on unmount
   */
  it('should clean up event listeners on unmount', () => {
    // Spy on addEventListener and removeEventListener
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

    const { unmount } = renderHook(() => useBreakpoints())

    // Unmount should trigger cleanup
    unmount()

    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))
    expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function))

    // Clean up spies
    addEventListenerSpy.mockRestore()
    removeEventListenerSpy.mockRestore()
  })
})
