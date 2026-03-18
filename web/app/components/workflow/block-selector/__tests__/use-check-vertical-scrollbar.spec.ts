import type * as React from 'react'
import { act, renderHook } from '@testing-library/react'
import useCheckVerticalScrollbar from '../use-check-vertical-scrollbar'

const resizeObserve = vi.fn()
const resizeDisconnect = vi.fn()
const mutationObserve = vi.fn()
const mutationDisconnect = vi.fn()

let resizeCallback: ResizeObserverCallback | null = null
let mutationCallback: MutationCallback | null = null

class MockResizeObserver implements ResizeObserver {
  observe = resizeObserve
  unobserve = vi.fn()
  disconnect = resizeDisconnect

  constructor(callback: ResizeObserverCallback) {
    resizeCallback = callback
  }
}

class MockMutationObserver implements MutationObserver {
  observe = mutationObserve
  disconnect = mutationDisconnect
  takeRecords = vi.fn(() => [])

  constructor(callback: MutationCallback) {
    mutationCallback = callback
  }
}

const setElementHeights = (element: HTMLElement, scrollHeight: number, clientHeight: number) => {
  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    value: scrollHeight,
  })
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    value: clientHeight,
  })
}

describe('useCheckVerticalScrollbar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resizeCallback = null
    mutationCallback = null
    vi.stubGlobal('ResizeObserver', MockResizeObserver)
    vi.stubGlobal('MutationObserver', MockMutationObserver)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should return false when the element ref is empty', () => {
    const ref = { current: null } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() => useCheckVerticalScrollbar(ref))

    expect(result.current).toBe(false)
    expect(resizeObserve).not.toHaveBeenCalled()
    expect(mutationObserve).not.toHaveBeenCalled()
  })

  it('should detect the initial scrollbar state and react to observer updates', () => {
    const element = document.createElement('div')
    setElementHeights(element, 200, 100)
    const ref = { current: element } as React.RefObject<HTMLElement | null>

    const { result } = renderHook(() => useCheckVerticalScrollbar(ref))

    expect(result.current).toBe(true)
    expect(resizeObserve).toHaveBeenCalledWith(element)
    expect(mutationObserve).toHaveBeenCalledWith(element, {
      childList: true,
      subtree: true,
      characterData: true,
    })

    setElementHeights(element, 100, 100)
    act(() => {
      resizeCallback?.([] as ResizeObserverEntry[], new MockResizeObserver(() => {}))
    })

    expect(result.current).toBe(false)

    setElementHeights(element, 180, 100)
    act(() => {
      mutationCallback?.([] as MutationRecord[], new MockMutationObserver(() => {}))
    })

    expect(result.current).toBe(true)
  })

  it('should disconnect observers on unmount', () => {
    const element = document.createElement('div')
    setElementHeights(element, 120, 100)
    const ref = { current: element } as React.RefObject<HTMLElement | null>

    const { unmount } = renderHook(() => useCheckVerticalScrollbar(ref))
    unmount()

    expect(resizeDisconnect).toHaveBeenCalledTimes(1)
    expect(mutationDisconnect).toHaveBeenCalledTimes(1)
  })
})
