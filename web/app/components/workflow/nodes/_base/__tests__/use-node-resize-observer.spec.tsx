import { renderHook } from '@testing-library/react'
import useNodeResizeObserver from '../use-node-resize-observer'

describe('useNodeResizeObserver', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it('should observe and disconnect when enabled with a mounted node ref', () => {
    const observe = vi.fn()
    const disconnect = vi.fn()
    const onResize = vi.fn()
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(1)
      return 1
    })
    const cancelAnimationFrame = vi.fn()
    let resizeCallback: ResizeObserverCallback | undefined

    vi.stubGlobal('requestAnimationFrame', requestAnimationFrame)
    vi.stubGlobal('cancelAnimationFrame', cancelAnimationFrame)
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }

      observe = observe
      disconnect = disconnect
      unobserve = vi.fn()
    })

    const node = document.createElement('div')
    const nodeRef = { current: node }

    const { unmount } = renderHook(() => useNodeResizeObserver({
      enabled: true,
      nodeRef,
      onResize,
    }))

    expect(observe).toHaveBeenCalledWith(node)
    resizeCallback?.([
      {
        borderBoxSize: [{ inlineSize: 244, blockSize: 184 }],
        contentRect: { width: 240, height: 180 },
      } as unknown as ResizeObserverEntry,
    ], {} as ResizeObserver)
    expect(requestAnimationFrame).toHaveBeenCalledTimes(1)
    expect(onResize).toHaveBeenCalledWith({ width: 244, height: 184 })

    unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
  })

  it('should do nothing when disabled', () => {
    const observe = vi.fn()

    vi.stubGlobal('ResizeObserver', class {
      observe = observe
      disconnect = vi.fn()
      unobserve = vi.fn()
    })

    renderHook(() => useNodeResizeObserver({
      enabled: false,
      nodeRef: { current: document.createElement('div') },
      onResize: vi.fn(),
    }))

    expect(observe).not.toHaveBeenCalled()
  })
})
