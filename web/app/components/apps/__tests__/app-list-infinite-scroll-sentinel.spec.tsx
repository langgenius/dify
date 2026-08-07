import type { RefObject } from 'react'
import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { AppListInfiniteScrollSentinel } from '../app-list-infinite-scroll-sentinel'

type MockObserver = {
  callback: IntersectionObserverCallback
  options?: IntersectionObserverInit
}

const observers: MockObserver[] = []

function getObserver(index: number) {
  const observer = observers[index]
  if (!observer) throw new Error(`Missing observer at index ${index}`)
  return observer
}

function Harness({
  canLoadMore,
  fetchNextPage,
}: {
  canLoadMore: boolean
  fetchNextPage: () => Promise<unknown>
}) {
  const scrollViewportRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={scrollViewportRef}>
      <AppListInfiniteScrollSentinel
        canLoadMore={canLoadMore}
        fetchNextPage={fetchNextPage}
        scrollViewportRef={scrollViewportRef as RefObject<HTMLDivElement | null>}
      />
    </div>
  )
}

describe('AppListInfiniteScrollSentinel', () => {
  beforeEach(() => {
    observers.length = 0
    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        callback: IntersectionObserverCallback
        disconnect() {}
        observe() {}
        root = null
        rootMargin = ''
        thresholds = []
        takeRecords = () => []
        unobserve = vi.fn()

        constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
          this.callback = callback
          observers.push({
            callback,
            options,
          })
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('loads again after the busy state clears', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    const { container, rerender } = render(<Harness canLoadMore fetchNextPage={fetchNextPage} />)

    const firstObserver = getObserver(0)
    const scrollRoot = container.firstElementChild
    expect(firstObserver.options?.root).toBe(scrollRoot)

    act(() => {
      firstObserver.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)

    rerender(<Harness canLoadMore={false} fetchNextPage={fetchNextPage} />)
    act(() => {
      firstObserver.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)

    rerender(<Harness canLoadMore fetchNextPage={fetchNextPage} />)
    const secondObserver = getObserver(1)
    act(() => {
      secondObserver.callback(
        [{ isIntersecting: true } as IntersectionObserverEntry],
        {} as IntersectionObserver,
      )
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(2)
  })
})
