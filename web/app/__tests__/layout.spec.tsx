import { QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient
const brandedFavicon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'

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
        favicon: brandedFavicon,
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
      icons: {
        apple: brandedFavicon,
        icon: brandedFavicon,
        shortcut: brandedFavicon,
      },
    })

    expect(mocks.getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(['console', 'system-features'])).toEqual({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
        favicon: brandedFavicon,
      },
      deployment_edition: 'CLOUD',
    })
  })

  it('renders the client recovery path when the server prefetch fails', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('system features unavailable'))
    const { default: RootLayout, generateMetadata } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()
    const metadata = await generateMetadata()

    expect(metadata).toMatchObject({
      title: {
        default: 'Dify',
        template: '%s - Dify',
      },
    })
    expect(metadata.icons).toBeUndefined()

    expect(queryClient.getQueryData(['console', 'system-features'])).toBeUndefined()
  })

  it.each([
    {
      branding: {
        application_title: 'Dify',
        enabled: false,
        favicon: brandedFavicon,
      },
      name: 'branding is disabled',
    },
    {
      branding: {
        application_title: 'Acme AI',
        enabled: true,
        favicon: '',
      },
      name: 'the branded favicon is empty',
    },
  ])('keeps the static favicon fallback when $name', async ({ branding }) => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding,
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    const metadata = await generateMetadata()

    expect(metadata.icons).toBeUndefined()
  })
})
