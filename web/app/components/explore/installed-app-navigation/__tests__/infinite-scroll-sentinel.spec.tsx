import { act, render } from '@testing-library/react'
import { useRef } from 'react'
import { InfiniteScrollSentinel } from '../infinite-scroll-sentinel'

type MockObserver = {
  callback: IntersectionObserverCallback
}

const observers: MockObserver[] = []

function Harness({
  canLoadMore,
  fetchNextPage,
}: {
  canLoadMore: boolean
  fetchNextPage: () => Promise<unknown>
}) {
  const scrollRootRef = useRef<HTMLDivElement>(null)

  return (
    <div ref={scrollRootRef}>
      <InfiniteScrollSentinel
        canLoadMore={canLoadMore}
        fetchNextPage={fetchNextPage}
        scrollRootRef={scrollRootRef}
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
        callback: IntersectionObserverCallback
        disconnect = vi.fn()
        observe = vi.fn()
        root = null
        rootMargin = ''
        thresholds = []
        takeRecords = () => []
        unobserve = vi.fn()

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          observers.push({ callback })
        }
      },
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not fetch again while busy and resumes when the query can load again', () => {
    const fetchNextPage = vi.fn().mockResolvedValue(undefined)
    const { rerender } = render(<Harness canLoadMore fetchNextPage={fetchNextPage} />)

    act(() => {
      observers
        .at(-1)
        ?.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
    })
    expect(fetchNextPage).toHaveBeenCalledOnce()

    rerender(<Harness canLoadMore={false} fetchNextPage={fetchNextPage} />)
    act(() => {
      observers
        .at(-1)
        ?.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
    })
    expect(fetchNextPage).toHaveBeenCalledOnce()

    rerender(<Harness canLoadMore fetchNextPage={fetchNextPage} />)
    act(() => {
      observers
        .at(-1)
        ?.callback(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          {} as IntersectionObserver,
        )
    })

    expect(fetchNextPage).toHaveBeenCalledTimes(2)
  })
})
