import type { DehydratedState, QueryClient } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { QueryClient as TanStackQueryClient } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  queryClient: undefined as QueryClient | undefined,
  getLocaleOnServer: vi.fn(),
  getServerConsoleClientContext: vi.fn(),
  resolveServerConsoleApiUrl: vi.fn(),
  templatesQueryOptions: vi.fn(),
  recentQueryOptions: vi.fn(),
  templatesQueryFn: vi.fn(),
  recentQueryFn: vi.fn(),
}))

vi.mock('@/context/query-client-server', () => ({
  makeQueryClient: () => mocks.queryClient,
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: () => mocks.getLocaleOnServer(),
}))

vi.mock('@/service/server', () => ({
  getServerConsoleClientContext: () => mocks.getServerConsoleClientContext(),
  resolveServerConsoleApiUrl: (...args: unknown[]) => mocks.resolveServerConsoleApiUrl(...args),
}))

vi.mock('@/app/components/explore/app-list/home-queries-server', () => ({
  getHomeTemplatesServerQueryOptions: (...args: unknown[]) => mocks.templatesQueryOptions(...args),
  getHomeContinueWorkServerQueryOptions: (...args: unknown[]) => mocks.recentQueryOptions(...args),
}))

describe('HomeHydrationBoundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryClient = new TanStackQueryClient({ defaultOptions: { queries: { retry: false } } })
    mocks.getLocaleOnServer.mockResolvedValue('en-US')
    mocks.getServerConsoleClientContext.mockResolvedValue({
      cookie: 'session=abc',
      csrfToken: 'csrf-token',
    })
    mocks.resolveServerConsoleApiUrl.mockReturnValue(
      'https://console.example.com/console/api/explore/apps',
    )
    mocks.templatesQueryFn.mockResolvedValue({ categories: ['Writing'], allList: [] })
    mocks.recentQueryFn.mockResolvedValue([])
    mocks.templatesQueryOptions.mockReturnValue({
      queryKey: ['console', 'explore', 'apps', 'get', { query: { language: 'en-US' } }, 'en-US'],
      queryFn: mocks.templatesQueryFn,
    })
    mocks.recentQueryOptions.mockReturnValue({
      queryKey: ['console', 'apps', 'recent', 'get', { query: { limit: 8 } }],
      queryFn: mocks.recentQueryFn,
    })
  })

  it('should dehydrate pending Home templates and recent queries without waiting for either request', async () => {
    let resolveTemplates: ((value: { categories: string[]; allList: never[] }) => void) | undefined
    let resolveRecent: ((value: never[]) => void) | undefined
    mocks.templatesQueryFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTemplates = resolve
        }),
    )
    mocks.recentQueryFn.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRecent = resolve
        }),
    )
    const { HomeHydrationBoundary } = await import('../home-hydration-boundary')
    const element = await HomeHydrationBoundary({ children: <div>Home content</div> })
    const state = (element as ReactElement<{ state: DehydratedState }>).props.state

    expect(mocks.templatesQueryOptions).toHaveBeenCalledWith('en-US', {
      cookie: 'session=abc',
      csrfToken: 'csrf-token',
    })
    expect(mocks.recentQueryOptions).toHaveBeenCalledWith({
      cookie: 'session=abc',
      csrfToken: 'csrf-token',
    })
    expect(state.queries.map((query) => query.queryKey)).toEqual([
      ['console', 'explore', 'apps', 'get', { query: { language: 'en-US' } }, 'en-US'],
      ['console', 'apps', 'recent', 'get', { query: { limit: 8 } }],
    ])
    expect(state.queries.map((query) => query.state.status)).toEqual(['pending', 'pending'])

    resolveTemplates?.({ categories: [], allList: [] })
    resolveRecent?.([])
  })

  it('should leave client queries as the fallback when no absolute server API URL is configured', async () => {
    mocks.resolveServerConsoleApiUrl.mockReturnValue(null)
    const { HomeHydrationBoundary } = await import('../home-hydration-boundary')
    const element = await HomeHydrationBoundary({ children: <div>Home content</div> })
    const state = (element as ReactElement<{ state: DehydratedState }>).props.state

    expect(mocks.getLocaleOnServer).not.toHaveBeenCalled()
    expect(mocks.getServerConsoleClientContext).not.toHaveBeenCalled()
    expect(state.queries).toHaveLength(0)
  })

  it('should preserve the client fallback when a server prefetch fails', async () => {
    mocks.templatesQueryFn.mockRejectedValue(new Error('templates unavailable'))
    const { HomeHydrationBoundary } = await import('../home-hydration-boundary')

    await expect(
      HomeHydrationBoundary({ children: <div>Home content</div> }),
    ).resolves.toBeDefined()
    expect(mocks.recentQueryFn).toHaveBeenCalledTimes(1)
  })
})
