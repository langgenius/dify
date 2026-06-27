const mocks = vi.hoisted(() => ({
  fetchQuery: vi.fn(),
  getQueryClientServer: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
  serverSystemFeaturesQueryOptions: vi.fn(() => ({ queryKey: ['console', 'systemFeatures', 'get'] })),
}))

vi.mock('@/context/query-client-server', () => ({
  getQueryClientServer: () => mocks.getQueryClientServer(),
}))

vi.mock('@/features/system-features/server', () => ({
  serverSystemFeaturesQueryOptions: () => mocks.serverSystemFeaturesQueryOptions(),
}))

vi.mock('@/next/navigation', () => ({
  notFound: () => mocks.notFound(),
}))

describe('guardDeploymentsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.fetchQuery.mockResolvedValue({ enable_app_deploy: true })
    mocks.getQueryClientServer.mockReturnValue({
      fetchQuery: mocks.fetchQuery,
    })
  })

  it('should allow deployments routes when app deploy is enabled', async () => {
    const { guardDeploymentsRoute } = await import('../feature-guard')

    await expect(guardDeploymentsRoute()).resolves.toBeUndefined()
    expect(mocks.serverSystemFeaturesQueryOptions).toHaveBeenCalledTimes(1)
    expect(mocks.fetchQuery).toHaveBeenCalledWith({
      queryKey: ['console', 'systemFeatures', 'get'],
    })
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('should throw notFound when app deploy is disabled', async () => {
    mocks.fetchQuery.mockResolvedValue({ enable_app_deploy: false })

    const { guardDeploymentsRoute } = await import('../feature-guard')

    await expect(guardDeploymentsRoute()).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
