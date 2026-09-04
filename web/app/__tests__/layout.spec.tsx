const mocks = vi.hoisted(() => ({
  dehydrateSystemFeatures: vi.fn(() => ({ mutations: [], queries: [] })),
  getOptionalSystemFeatures: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/features/system-features/server', () => ({
  dehydrateSystemFeatures: mocks.dehydrateSystemFeatures,
  getOptionalSystemFeatures: mocks.getOptionalSystemFeatures,
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
  })

  it('uses optional System Features for branded metadata', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue({
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
  })

  it('points the icons at the branding favicon when one is configured', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue({
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
    mocks.getOptionalSystemFeatures.mockResolvedValue({
      branding: { enabled: false },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      icons: { icon: '/favicon.ico' },
    })
  })

  it('falls back to the static favicon when branding is enabled without one', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue({
      branding: { application_title: 'Acme AI', enabled: true, favicon: '' },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      icons: { icon: '/favicon.ico' },
    })
  })

  it('renders the client recovery path when optional System Features are unavailable', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue(undefined)
    const { default: RootLayout, generateMetadata } = await import('../layout')

    await expect(RootLayout({ children: <div>App</div> })).resolves.toBeDefined()
    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        default: 'Dify',
        template: '%s - Dify',
      },
    })
  })
})
