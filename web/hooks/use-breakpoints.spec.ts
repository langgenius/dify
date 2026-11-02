import { act, renderHook } from '@testing-library/react'
import { createElement } from 'react'
import { hydrateRoot } from 'react-dom/client'
import { renderToString } from 'react-dom/server'
import useBreakpoints, { MediaType } from './use-breakpoints'

describe('useBreakpoints', () => {
  const originalInnerWidth = window.innerWidth

  const fireResize = (width: number) => {
    window.innerWidth = width
    act(() => {
      window.dispatchEvent(new Event('resize'))
    })
  }

  afterEach(() => {
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

  it('should update media type when window resizes', () => {
    // Start with desktop
    Object.defineProperty(window, 'innerWidth', {
      writable: true,
      configurable: true,
      value: 1024,
    })

    const { result } = renderHook(() => useBreakpoints())
    expect(result.current).toBe(MediaType.pc)

    fireResize(768)
    expect(result.current).toBe(MediaType.tablet)
    fireResize(641)
    expect(result.current).toBe(MediaType.tablet)
    fireResize(640)
    expect(result.current).toBe(MediaType.mobile)
    fireResize(769)
    expect(result.current).toBe(MediaType.pc)
  })
})
