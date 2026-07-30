import type { RefObject } from 'react'
import { act, render } from '@testing-library/react'
import { InfiniteScrollSentinel } from '../infinite-scroll-sentinel'

describe('InfiniteScrollSentinel', () => {
  it('does not observe again after a next-page request completes', () => {
    const fetchNextPage = vi.fn(() => Promise.resolve())
    const scrollRootRef: RefObject<HTMLDivElement | null> = {
      current: document.createElement('div'),
    }
    const observerConstructed = vi.fn()

    vi.stubGlobal(
      'IntersectionObserver',
      class MockIntersectionObserver {
        private readonly callback: IntersectionObserverCallback

        constructor(callback: IntersectionObserverCallback) {
          this.callback = callback
          observerConstructed()
        }

        observe() {
          this.callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          )
        }

        disconnect() {}
        unobserve() {}
      },
    )

    const { rerender } = render(
      <InfiniteScrollSentinel
        canFetchNextPage
        fetchNextPage={fetchNextPage}
        isFetchingNextPage={false}
        scrollRootRef={scrollRootRef}
      />,
    )

    expect(fetchNextPage).toHaveBeenCalledOnce()

    act(() => {
      rerender(
        <InfiniteScrollSentinel
          canFetchNextPage
          fetchNextPage={fetchNextPage}
          isFetchingNextPage
          scrollRootRef={scrollRootRef}
        />,
      )
    })
    act(() => {
      rerender(
        <InfiniteScrollSentinel
          canFetchNextPage
          fetchNextPage={fetchNextPage}
          isFetchingNextPage={false}
          scrollRootRef={scrollRootRef}
        />,
      )
    })

    expect(observerConstructed).toHaveBeenCalledOnce()
    expect(fetchNextPage).toHaveBeenCalledOnce()
  })
})
