import { act, renderHook } from '@testing-library/react'
import useBreakpoints, { MediaType } from './use-breakpoints'

describe('useBreakpoints', () => {
  const originalInnerWidth = window.innerWidth

  // Mock the window resize event
  const fireResize = (width: number) => {
    window.innerWidth = width
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  // Restore the original innerWidth after tests
  afterAll(() => {
    window.innerWidth = originalInnerWidth
  })

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

  it('should clean up event listeners on unmount', () => {
    // Spy on addEventListener and removeEventListener
    const addEventListenerSpy = jest.spyOn(window, 'addEventListener')
    const removeEventListenerSpy = jest.spyOn(window, 'removeEventListener')

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
