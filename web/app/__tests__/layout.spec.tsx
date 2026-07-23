const mocks = vi.hoisted(() => ({
  dehydrateSystemFeatures: vi.fn(() => ({ mutations: [], queries: [] })),
  ensureQueryData: vi.fn(),
  getCloudAnalyticsBoundaryState: vi.fn(() => ({ enabled: false })),
  queryOptions: { queryKey: ['console', 'system-features'] },
  requestHeaders: new Headers(),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => ({
    ensureQueryData: mocks.ensureQueryData,
  }),
}))

vi.mock('@/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/env')>()

  return {
    ...actual,
    getDatasetMap: () => ({}),
  }
})

vi.mock('@/features/system-features/server', () => ({
  dehydrateSystemFeatures: mocks.dehydrateSystemFeatures,
  serverSystemFeaturesQueryOptions: () => mocks.queryOptions,
}))

vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: async () => 'en-US',
}))

vi.mock('@/next/headers', () => ({
  headers: async () => mocks.requestHeaders,
}))

vi.mock('@/app/components/base/analytics-consent/cloud-analytics-state', () => ({
  getCloudAnalyticsBoundaryState: mocks.getCloudAnalyticsBoundaryState,
}))

describe('Root layout System Features bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders only after System Features resolves and dehydrates that successful query', async () => {
    mocks.ensureQueryData.mockResolvedValue({ deployment_edition: 'CLOUD' })
    const { default: RootLayout } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()

    expect(mocks.ensureQueryData).toHaveBeenCalledWith(mocks.queryOptions)
    expect(mocks.dehydrateSystemFeatures).toHaveBeenCalledTimes(1)
    expect(mocks.getCloudAnalyticsBoundaryState).toHaveBeenCalledWith(
      mocks.requestHeaders,
      'CLOUD',
    )
  })

  it('propagates System Features failures without dehydrating or rendering a fallback', async () => {
    const error = new Error('system features unavailable')
    mocks.ensureQueryData.mockRejectedValue(error)
    const { default: RootLayout } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).rejects.toBe(error)

    expect(mocks.dehydrateSystemFeatures).not.toHaveBeenCalled()
    expect(mocks.getCloudAnalyticsBoundaryState).not.toHaveBeenCalled()
  })
})
