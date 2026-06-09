import type { TocItem } from '../use-doc-toc'
import { act, renderHook } from '@testing-library/react'
import { useDocToc } from '../use-doc-toc'

const mockMatchMedia = (matches: boolean) => {
  vi.stubGlobal('matchMedia', vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })))
}

const setupDocument = () => {
  document.body.innerHTML = `
    <div class="overflow-auto"></div>
    <article>
      <h2 id="intro"><a href="#intro">Intro</a></h2>
      <h2 id="details"><a href="#details">Details</a></h2>
    </article>
  `

  const scrollContainer = document.querySelector('.overflow-auto') as HTMLDivElement
  scrollContainer.scrollTo = vi.fn()

  const intro = document.getElementById('intro') as HTMLElement
  const details = document.getElementById('details') as HTMLElement

  Object.defineProperty(intro, 'offsetTop', { configurable: true, value: 140 })
  Object.defineProperty(details, 'offsetTop', { configurable: true, value: 320 })

  return {
    scrollContainer,
    intro,
    details,
  }
}

describe('useDocToc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    document.body.innerHTML = ''
    mockMatchMedia(false)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('should extract headings and expand the TOC on wide screens', async () => {
    setupDocument()
    mockMatchMedia(true)

    const { result } = renderHook(() => useDocToc({
      appDetail: { id: 'app-1' },
      locale: 'en',
    }))

    act(() => {
      vi.runAllTimers()
    })

    expect(result.current.toc).toEqual<TocItem[]>([
      { href: '#intro', text: 'Intro' },
      { href: '#details', text: 'Details' },
    ])
    expect(result.current.activeSection).toBe('intro')
    expect(result.current.isTocExpanded).toBe(true)
  })

  it('should update the active section when the scroll container scrolls', async () => {
    const { scrollContainer, intro, details } = setupDocument()
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })

    intro.getBoundingClientRect = vi.fn(() => ({ top: 500 } as DOMRect))
    details.getBoundingClientRect = vi.fn(() => ({ top: 300 } as DOMRect))

    const { result } = renderHook(() => useDocToc({
      appDetail: { id: 'app-1' },
      locale: 'en',
    }))

    act(() => {
      vi.runAllTimers()
    })

    act(() => {
      scrollContainer.dispatchEvent(new Event('scroll'))
    })

    expect(result.current.activeSection).toBe('details')
  })

  it('should scroll the container to the clicked heading offset', async () => {
    const { scrollContainer } = setupDocument()
    const { result } = renderHook(() => useDocToc({
      appDetail: { id: 'app-1' },
      locale: 'en',
    }))

    act(() => {
      vi.runAllTimers()
    })

    const preventDefault = vi.fn()
    act(() => {
      result.current.handleTocClick(
        { preventDefault } as unknown as React.MouseEvent<HTMLAnchorElement>,
        { href: '#details', text: 'Details' },
      )
    })

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(scrollContainer.scrollTo).toHaveBeenCalledWith({
      top: 240,
      behavior: 'smooth',
    })
  })
})
