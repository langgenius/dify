import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { HomePage } from '../page'

const mocks = vi.hoisted(() => ({
  getQueryClient: vi.fn(),
  recentApps: vi.fn(),
}))

vi.mock('@/app/get-query-client', () => ({ getQueryClient: mocks.getQueryClient }))
vi.mock('@/i18n-config/server', () => ({ getLocaleOnServer: async () => 'en-US' }))
vi.mock('@/features/system-features/server', () => ({
  getOptionalSystemFeatures: async () => ({ enable_explore_banner: false }),
}))
vi.mock('@/service/console', () => ({
  consoleQuery: {
    apps: {
      recent: {
        get: {
          queryOptions: () => ({
            queryKey: ['recent-apps'],
            queryFn: mocks.recentApps,
          }),
        },
      },
    },
    explore: {
      apps: {
        get: {
          queryOptions: () => ({
            queryKey: ['templates'],
            queryFn: async () => ({ recommended_apps: [], categories: [] }),
          }),
        },
      },
    },
  },
}))
vi.mock('../home-content/home-content', () => ({
  HomeContent: () => {
    throw new Promise(() => {})
  },
}))
vi.mock('../home-skeleton', () => ({
  HomeSkeleton: () => <div role="status">Loading home</div>,
}))

describe('HomePage initial layout', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getQueryClient.mockReturnValue(
      new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    )
  })

  it('returns the loading shell without waiting for recent apps', async () => {
    let resolveRecentApps!: (value: { data: [] }) => void
    mocks.recentApps.mockReturnValue(
      new Promise((resolve) => {
        resolveRecentApps = resolve
      }),
    )

    const page = await HomePage()
    expect(mocks.recentApps).toHaveBeenCalledOnce()
    render(<QueryClientProvider client={new QueryClient()}>{page}</QueryClientProvider>)
    expect(screen.getByRole('status')).toHaveTextContent('Loading home')

    resolveRecentApps({ data: [] })
  })
})
