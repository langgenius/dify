import type { InfiniteScrollQueryResult, UseInfiniteScrollOptions } from '../use-infinite-scroll'
import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useInfiniteScroll } from '../use-infinite-scroll'

let intersectionCallback: IntersectionObserverCallback | undefined
let intersectionOptions: IntersectionObserverInit | undefined
const observe = vi.fn()
const disconnect = vi.fn()
const unobserve = vi.fn()
const originalIntersectionObserver = globalThis.IntersectionObserver

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly scrollMargin = ''
  readonly thresholds: ReadonlyArray<number>

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    intersectionCallback = callback
    intersectionOptions = options
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? ''
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
  }

  observe = observe
  unobserve = unobserve
  disconnect = disconnect
  takeRecords = () => []
}

function TestInfiniteScroll({
  options,
  query,
}: {
  options?: UseInfiniteScrollOptions
  query: InfiniteScrollQueryResult
}) {
  const { rootRef, sentinelRef } = useInfiniteScroll<HTMLDivElement, HTMLDivElement>(query, options)

  return createElement(
    'div',
    { ref: rootRef, 'data-testid': 'scroll-root' },
    createElement('div', { ref: sentinelRef, 'data-testid': 'scroll-sentinel' }),
  )
}

function createInfiniteScrollQuery(
  overrides: Partial<InfiniteScrollQueryResult> = {},
): InfiniteScrollQueryResult {
  return {
    error: null,
    fetchNextPage: vi.fn(() => Promise.resolve()),
    hasNextPage: true,
    isFetching: false,
    isFetchingNextPage: false,
    isLoading: false,
    ...overrides,
  }
}

function renderInfiniteScroll(
  query: InfiniteScrollQueryResult,
  options?: UseInfiniteScrollOptions,
) {
  const view = render(createElement(TestInfiniteScroll, { options, query }))

  return {
    ...view,
    root: view.getByTestId('scroll-root'),
    sentinel: view.getByTestId('scroll-sentinel'),
  }
}

function triggerIntersection(isIntersecting: boolean) {
  if (!intersectionCallback)
    throw new Error('Expected IntersectionObserver callback to be registered')

  intersectionCallback(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

describe('useInfiniteScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    intersectionCallback = undefined
    intersectionOptions = undefined
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver
  })

  afterAll(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver
  })

  // The hook owns both refs and wires the sentinel to the scroll container root.
  it('should observe the sentinel with the scroll root', () => {
    const query = createInfiniteScrollQuery()
    const { root, sentinel } = renderInfiniteScroll(query)

    expect(observe).toHaveBeenCalledWith(sentinel)
    expect(intersectionOptions?.root).toBe(root)
    expect(intersectionOptions?.rootMargin).toBe('0px 0px 300px 0px')
    expect(intersectionOptions?.threshold).toBe(0)
  })

  // Pagination starts when the sentinel enters the configured observer area.
  it('should load more when the sentinel intersects', () => {
    const query = createInfiniteScrollQuery()
    renderInfiniteScroll(query)

    triggerIntersection(true)

    expect(query.fetchNextPage).toHaveBeenCalledTimes(1)
    expect(query.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
  })

  // Non-intersecting observer entries should not advance the query.
  it('should not load more when the sentinel is outside the observer area', () => {
    const query = createInfiniteScrollQuery()
    renderInfiniteScroll(query)

    triggerIntersection(false)

    expect(query.fetchNextPage).not.toHaveBeenCalled()
  })

  // Query state should gate observer registration so stale or duplicate loads do not fire.
  it.each([
    ['has no next page', { hasNextPage: false }],
    ['is loading', { isLoading: true }],
    ['is fetching the next page', { isFetchingNextPage: true }],
    ['is fetching and guarded', { isFetching: true }],
    ['has an error', { error: new Error('load failed') }],
  ] as const)('should not observe when the query %s', (_label, overrides) => {
    const query = createInfiniteScrollQuery(overrides)

    renderInfiniteScroll(query)

    expect(observe).not.toHaveBeenCalled()
    expect(query.fetchNextPage).not.toHaveBeenCalled()
  })

  // Options are passed through to IntersectionObserver and fetchNextPage.
  it('should use custom observer and fetch options', () => {
    const query = createInfiniteScrollQuery()
    renderInfiniteScroll(query, {
      cancelRefetch: true,
      rootMargin: '0px 0px 160px 0px',
      threshold: 0.1,
    })

    triggerIntersection(true)

    expect(intersectionOptions?.rootMargin).toBe('0px 0px 160px 0px')
    expect(intersectionOptions?.threshold).toBe(0.1)
    expect(query.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: true })
  })

  // Window mode observes against the viewport instead of the local scroll container.
  it('should use the viewport root when useWindow is enabled', () => {
    const query = createInfiniteScrollQuery()
    renderInfiniteScroll(query, { useWindow: true })

    expect(intersectionOptions?.root).toBeNull()
  })

  // The local lock avoids repeated calls while TanStack Query is still resolving fetchNextPage.
  it('should not request another page while the previous request is pending', async () => {
    let resolveFetch: (value?: unknown) => void = () => undefined
    const fetchNextPage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    const query = createInfiniteScrollQuery({ fetchNextPage })
    renderInfiniteScroll(query)

    triggerIntersection(true)
    triggerIntersection(true)

    expect(fetchNextPage).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFetch()
      await Promise.resolve()
    })
  })

  // Cleanup matters when the list unmounts or query state recreates the observer.
  it('should disconnect the observer on unmount', () => {
    const query = createInfiniteScrollQuery()
    const { unmount } = renderInfiniteScroll(query)

    unmount()

    expect(disconnect).toHaveBeenCalledTimes(1)
  })
})
