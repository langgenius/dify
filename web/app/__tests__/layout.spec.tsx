import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
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

  it('points the icons at the branding favicon when one is configured', async () => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
        favicon: 'https://cdn.example.com/brand.ico',
      },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      icons: {
        icon: 'https://cdn.example.com/brand.ico',
        apple: 'https://cdn.example.com/brand.ico',
      },
    })
  })

  it('falls back to the static favicon without branding', async () => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding: { enabled: false },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      icons: { icon: '/favicon.ico' },
    })
  })

  it('falls back to the static favicon when branding is enabled without one', async () => {
    mocks.getSystemFeatures.mockResolvedValue({
      branding: { application_title: 'Acme AI', enabled: true, favicon: '' },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      icons: { icon: '/favicon.ico' },
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

  it('does not inject marketplace PWA chrome or a global ResizeObserver filter', () => {
    const source = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), '../layout.tsx'),
      'utf8',
    )

    expect(source).not.toContain('manifest.json')
    expect(source).not.toContain('apple-touch-icon')
    expect(source).not.toContain('browserconfig.xml')
    expect(source).not.toContain('ResizeObserver')
  })
})
