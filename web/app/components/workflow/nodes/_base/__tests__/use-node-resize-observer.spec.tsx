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
    let resizeCallback: (() => void) | undefined

    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) {
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
    resizeCallback?.()
    expect(onResize).toHaveBeenCalledTimes(1)

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
