import { QueryClient } from '@tanstack/react-query'

let queryClient: QueryClient

const mocks = vi.hoisted(() => ({
  getSystemFeatures: vi.fn(),
  requestHeaders: new Headers(),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => queryClient,
}))

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()

  return {
    ...actual,
    getDatasetMap: () => ({}),
  }
})

vi.mock('@/service/server', () => ({
  serverConsoleQuery: {
    systemFeatures: {
      get: {
        queryOptions: () => ({
          queryKey: ['console', 'system-features'],
          queryFn: mocks.getSystemFeatures,
          retry: false,
        }),
      },
    },
  },
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/next/headers', () => ({
  headers: async () => mocks.requestHeaders,
}))

describe('Root layout System Features bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  })

  it('caches the resolved System Features for dehydration', async () => {
    mocks.getSystemFeatures.mockResolvedValue({ deployment_edition: 'CLOUD' })
    const { default: RootLayout } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()

    expect(mocks.getSystemFeatures).toHaveBeenCalledTimes(1)
    expect(queryClient.getQueryData(['console', 'system-features'])).toEqual({
      deployment_edition: 'CLOUD',
    })
  })

  it('renders the client recovery path when the server prefetch fails', async () => {
    mocks.getSystemFeatures.mockRejectedValue(new Error('system features unavailable'))
    const { default: RootLayout } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()

    expect(queryClient.getQueryData(['console', 'system-features'])).toBeUndefined()
  })
})
