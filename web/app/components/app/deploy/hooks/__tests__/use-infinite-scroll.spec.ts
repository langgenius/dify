import type { InfiniteScrollQuery } from '../use-infinite-scroll'
import { act, render } from '@testing-library/react'
import { createElement } from 'react'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { useInfiniteScroll } from '../use-infinite-scroll'

let intersectionCallback: IntersectionObserverCallback | undefined
let intersectionOptions: IntersectionObserverInit | undefined
let scrollRoot: HTMLDivElement | null = null
let scrollSentinel: HTMLDivElement | null = null
const observe = vi.fn()
const disconnect = vi.fn()
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
  unobserve = vi.fn()
  disconnect = disconnect
  takeRecords = () => []
}

function TestInfiniteScroll({ query }: { query: InfiniteScrollQuery }) {
  const { rootRef, sentinelRef } = useInfiniteScroll(query)

  return createElement(
    'div',
    {
      ref: (node: HTMLDivElement | null) => {
        scrollRoot = node
        rootRef(node)
      },
    },
    createElement('div', {
      ref: (node: HTMLDivElement | null) => {
        scrollSentinel = node
        sentinelRef(node)
      },
    }),
  )
}

function createQuery(overrides: Partial<InfiniteScrollQuery> = {}): InfiniteScrollQuery {
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

function triggerIntersection(isIntersecting: boolean) {
  if (!intersectionCallback)
    throw new Error('Expected IntersectionObserver callback to be registered')

  intersectionCallback(
    [{ isIntersecting } as IntersectionObserverEntry],
    {} as IntersectionObserver,
  )
}

describe('deploy useInfiniteScroll', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    intersectionCallback = undefined
    intersectionOptions = undefined
    scrollRoot = null
    scrollSentinel = null
    globalThis.IntersectionObserver =
      MockIntersectionObserver as unknown as typeof IntersectionObserver
  })

  afterAll(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver
  })

  it('should observe the sentinel within the version list', () => {
    render(createElement(TestInfiniteScroll, { query: createQuery() }))

    expect(scrollRoot).not.toBeNull()
    expect(scrollSentinel).not.toBeNull()
    expect(observe).toHaveBeenCalledWith(scrollSentinel)
    expect(intersectionOptions).toMatchObject({
      root: scrollRoot,
      rootMargin: '0px 0px 300px 0px',
      threshold: 0,
    })
  })

  it('should fetch the next page when the sentinel intersects', () => {
    const query = createQuery()
    render(createElement(TestInfiniteScroll, { query }))

    triggerIntersection(true)

    expect(query.fetchNextPage).toHaveBeenCalledOnce()
    expect(query.fetchNextPage).toHaveBeenCalledWith({ cancelRefetch: false })
  })

  it.each([
    ['there is no next page', { hasNextPage: false }],
    ['the first page is loading', { isLoading: true }],
    ['another request is running', { isFetching: true }],
    ['the next page is loading', { isFetchingNextPage: true }],
    ['the query has failed', { error: new Error('load failed') }],
  ] as const)('should not observe when %s', (_label, overrides) => {
    const query = createQuery(overrides)

    render(createElement(TestInfiniteScroll, { query }))

    expect(observe).not.toHaveBeenCalled()
  })

  it('should lock pagination until the current request settles', async () => {
    let resolveFetch: (value?: unknown) => void = () => undefined
    const fetchNextPage = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve
        }),
    )
    render(
      createElement(TestInfiniteScroll, {
        query: createQuery({ fetchNextPage }),
      }),
    )

    triggerIntersection(true)
    triggerIntersection(true)

    expect(fetchNextPage).toHaveBeenCalledOnce()

    await act(async () => {
      resolveFetch()
      await Promise.resolve()
    })
  })

  it('should disconnect the observer on unmount', () => {
    const view = render(createElement(TestInfiniteScroll, { query: createQuery() }))

    view.unmount()

    expect(disconnect).toHaveBeenCalled()
  })
})
