import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { InfiniteScrollSentinel } from '..'

type ObserverRecord = {
  callback: IntersectionObserverCallback
  disconnect: ReturnType<typeof vi.fn>
  observe: ReturnType<typeof vi.fn>
  options?: IntersectionObserverInit
}

const observers: ObserverRecord[] = []

function getObserver(index: number) {
  const observer = observers[index]

  if (!observer) throw new Error(`Missing observer at index ${index}`)

  return observer
}

function triggerIntersection(observer: ObserverRecord, isIntersecting: boolean) {
  act(() => {
    observer.callback([{ isIntersecting } as IntersectionObserverEntry], {} as IntersectionObserver)
  })
}

function Harness({
  canLoadMore,
  onLoadMore,
  preloadDistance,
}: {
  canLoadMore: boolean
  onLoadMore: () => void
  preloadDistance: number | ((scrollContainer: Element) => number)
}) {
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={scrollContainerRef}>
      <InfiniteScrollSentinel
        scrollContainerRef={scrollContainerRef}
        canLoadMore={canLoadMore}
        preloadDistance={preloadDistance}
        onLoadMore={onLoadMore}
      />
    </div>
  )
}

describe('InfiniteScrollSentinel', () => {
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        readonly root: Element | Document | null
        readonly rootMargin: string
        readonly scrollMargin = ''
        readonly thresholds: ReadonlyArray<number>
        readonly disconnect = vi.fn()
        readonly observe = vi.fn()
        readonly takeRecords = () => []
        readonly unobserve = vi.fn()

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.root = options?.root ?? null
          this.rootMargin = options?.rootMargin ?? ''
          this.thresholds = Array.isArray(options?.threshold)
            ? options.threshold
            : [options?.threshold ?? 0]
          observers.push({
            callback,
            disconnect: this.disconnect,
            observe: this.observe,
            options,
          })
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('observes the sentinel relative to the provided scroll container', () => {
    const { container } = render(<Harness canLoadMore preloadDistance={160} onLoadMore={vi.fn()} />)
    const observer = getObserver(0)
    const scrollContainer = container.firstElementChild

    expect(observer.options).toEqual({
      root: scrollContainer,
      rootMargin: '0px 0px 160px 0px',
      threshold: 0,
    })
    expect(observer.observe).toHaveBeenCalledOnce()
  })

  it('resolves a business-owned preload distance from the scroll container', () => {
    const getPreloadDistance = vi.fn(() => 240)
    const { container } = render(
      <Harness canLoadMore preloadDistance={getPreloadDistance} onLoadMore={vi.fn()} />,
    )
    const scrollContainer = container.firstElementChild

    expect(getPreloadDistance).toHaveBeenCalledWith(scrollContainer)
    expect(getObserver(0).options?.rootMargin).toBe('0px 0px 240px 0px')
  })

  it('notifies whenever the sentinel enters the preload area while loading is allowed', () => {
    const onLoadMore = vi.fn()
    render(<Harness canLoadMore preloadDistance={160} onLoadMore={onLoadMore} />)
    const observer = getObserver(0)

    triggerIntersection(observer, true)
    triggerIntersection(observer, false)
    triggerIntersection(observer, true)

    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })

  it('pauses load notifications while loading is disallowed and resumes when allowed again', () => {
    const onLoadMore = vi.fn()
    const { rerender } = render(
      <Harness canLoadMore preloadDistance={160} onLoadMore={onLoadMore} />,
    )
    const firstObserver = getObserver(0)

    triggerIntersection(firstObserver, true)
    expect(onLoadMore).toHaveBeenCalledOnce()

    rerender(<Harness canLoadMore={false} preloadDistance={160} onLoadMore={onLoadMore} />)
    triggerIntersection(firstObserver, true)
    expect(onLoadMore).toHaveBeenCalledOnce()

    rerender(<Harness canLoadMore preloadDistance={160} onLoadMore={onLoadMore} />)
    triggerIntersection(getObserver(1), true)
    expect(onLoadMore).toHaveBeenCalledTimes(2)
  })

  it('uses the latest load callback after rerendering', () => {
    const firstOnLoadMore = vi.fn()
    const nextOnLoadMore = vi.fn()
    const { rerender } = render(
      <Harness canLoadMore preloadDistance={160} onLoadMore={firstOnLoadMore} />,
    )

    rerender(<Harness canLoadMore preloadDistance={160} onLoadMore={nextOnLoadMore} />)
    triggerIntersection(getObserver(observers.length - 1), true)

    expect(firstOnLoadMore).not.toHaveBeenCalled()
    expect(nextOnLoadMore).toHaveBeenCalledOnce()
  })

  it('disconnects the observer on unmount', () => {
    const { unmount } = render(<Harness canLoadMore preloadDistance={160} onLoadMore={vi.fn()} />)
    const observer = getObserver(0)

    unmount()

    expect(observer.disconnect).toHaveBeenCalledOnce()
  })
})
