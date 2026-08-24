import { QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  getSystemFeatures: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/features/system-features/server', () => ({
  getSystemFeaturesQueryClient: () => queryClient,
  prefetchSystemFeatures: async () => {
    const queryOptions = {
      queryKey: ['console', 'system-features'],
      queryFn: mocks.getSystemFeatures,
      retry: false,
    }
    if (!queryClient.getQueryState(queryOptions.queryKey))
      await queryClient.prefetchQuery(queryOptions)
    return queryClient.getQueryData(queryOptions.queryKey)
  },
}))

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()

  return {
    ...actual,
    getDatasetMap: () => ({}),
  }
})

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/next/headers', () => ({
  headers: mocks.headers,
}))

describe('Root layout System Features bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.headers.mockResolvedValue(new Headers())
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('caches the resolved System Features for dehydration', async () => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
      },
      deployment_edition: 'CLOUD',
    })
    const { default: RootLayout, generateMetadata } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()
    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        default: 'Acme AI',
        template: '%s - Acme AI',
      },
    })

    expect(mocks.getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(['console', 'system-features'])).toEqual({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
      },
      deployment_edition: 'CLOUD',
    })
  })

  it('renders the client recovery path when the server prefetch fails', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('system features unavailable'))
    const { default: RootLayout, generateMetadata } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()
    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        default: 'Dify',
        template: '%s - Dify',
      },
    })

    expect(queryClient.getQueryData(['console', 'system-features'])).toBeUndefined()
  })
})
