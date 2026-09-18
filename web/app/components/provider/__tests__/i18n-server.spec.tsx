// @vitest-environment node

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getLocaleOnServer: vi.fn(),
  getResourcesForPath: vi.fn(),
}))

vi.mock('@/next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/i18n-config/server', () => ({
  getLocaleOnServer: mocks.getLocaleOnServer,
  getResourcesForPath: mocks.getResourcesForPath,
}))
vi.mock('../i18n', () => ({
  I18nClientProvider: ({ children }: { children: React.ReactNode }) => children,
}))

describe('I18nServerProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.headers.mockResolvedValue(new Headers({ 'x-dify-pathname': '/datasets' }))
    mocks.getLocaleOnServer.mockResolvedValue('en-US')
    mocks.getResourcesForPath.mockResolvedValue({ 'en-US': { common: {} } })
  })

  it('loads locale resources for the request pathname', async () => {
    const { I18nServerProvider } = await import('../i18n-server')
    await I18nServerProvider({ children: 'child' })

    expect(mocks.getLocaleOnServer).toHaveBeenCalled()
    expect(mocks.getResourcesForPath).toHaveBeenCalledWith('en-US', '/datasets')
  })

  it('defaults to the root pathname when the proxy header is missing', async () => {
    mocks.headers.mockResolvedValue(new Headers())
    const { I18nServerProvider } = await import('../i18n-server')
    await I18nServerProvider({ children: 'child' })

    expect(mocks.getResourcesForPath).toHaveBeenCalledWith('en-US', '/')
  })
})
