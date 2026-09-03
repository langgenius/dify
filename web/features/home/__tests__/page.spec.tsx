// @vitest-environment node

import type { DehydratedState } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { defaultShouldDehydrateQuery, QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  getOptionalSystemFeatures: vi.fn(),
  getRecentApps: vi.fn(),
  getServerConsoleClientContext: vi.fn(async () => ({ headers: {} })),
  getTemplates: vi.fn(),
  getBanners: vi.fn(),
}))

vi.mock('@/app/get-query-client', () => ({
  getQueryClient: () => queryClient,
}))

vi.mock('@/features/system-features/server', () => ({
  getOptionalSystemFeatures: mocks.getOptionalSystemFeatures,
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/service/server', () => ({
  getServerConsoleClientContext: mocks.getServerConsoleClientContext,
  serverConsoleQuery: {
    apps: {
      recent: {
        get: {
          queryOptions: () => ({
            queryKey: ['apps', 'recent'],
            queryFn: mocks.getRecentApps,
            retry: false,
          }),
        },
      },
    },
    explore: {
      apps: {
        get: {
          queryOptions: () => ({
            queryKey: ['explore', 'apps'],
            queryFn: mocks.getTemplates,
            retry: false,
          }),
        },
      },
      banners: {
        get: {
          queryOptions: () => ({
            queryKey: ['explore', 'banners'],
            queryFn: mocks.getBanners,
            retry: false,
          }),
        },
      },
    },
  },
}))

vi.mock('../home-content/home-content', () => ({
  HomeContent: () => null,
}))

vi.mock('../home-shell', () => ({
  HomeShell: ({ children }: { children: React.ReactNode }) => children,
}))

vi.mock('../home-skeleton', () => ({
  HomeSkeleton: () => null,
}))

function pendingRequest() {
  return new Promise<never>(() => undefined)
}

type SkeletonElement = ReactElement<{ showBanner: boolean }>
type ShellContentElement = ReactElement<{ children: SkeletonElement }>
type ShellElement = ReactElement<{ children: ShellContentElement }>
type SuspenseElement = ReactElement<{ fallback: ShellElement }>
type PageElement = ReactElement<{ children: SuspenseElement; state: DehydratedState }>

function getFallbackShowBanner(page: PageElement) {
  const suspense = page.props.children
  const shell = suspense.props.fallback
  const shellContent = shell.props.children
  const skeleton = shellContent.props.children
  return skeleton.props.showBanner
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        dehydrate: {
          shouldDehydrateQuery: (query) =>
            defaultShouldDehydrateQuery(query) || query.state.status === 'pending',
          shouldRedactErrors: () => false,
        },
      },
    })
    mocks.getOptionalSystemFeatures.mockResolvedValue(undefined)
    mocks.getTemplates.mockImplementation(pendingRequest)
    mocks.getRecentApps.mockImplementation(pendingRequest)
    mocks.getBanners.mockImplementation(pendingRequest)
  })

  it('keeps rendering and skips the banner when optional System Features are unavailable', async () => {
    const { HomePage } = await import('../page')

    const page = (await HomePage()) as PageElement

    expect(getFallbackShowBanner(page)).toBe(false)
    expect(page.props.state.queries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ queryKey: ['explore', 'apps'] }),
        expect.objectContaining({ queryKey: ['apps', 'recent'] }),
      ]),
    )
    expect(page.props.state.queries).toHaveLength(2)
    expect(mocks.getBanners).not.toHaveBeenCalled()
  })

  it('prefetches and reflects the banner when the capability is enabled', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue({ enable_explore_banner: true })
    const { HomePage } = await import('../page')

    const page = (await HomePage()) as PageElement

    expect(getFallbackShowBanner(page)).toBe(true)
    expect(page.props.state.queries).toEqual(
      expect.arrayContaining([expect.objectContaining({ queryKey: ['explore', 'banners'] })]),
    )
    expect(page.props.state.queries).toHaveLength(3)
  })
})
