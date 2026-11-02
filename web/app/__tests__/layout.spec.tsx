import { renderToStaticMarkup } from 'react-dom/server'

const mocks = vi.hoisted(() => ({
  dehydrateSystemFeatures: vi.fn(() => ({ mutations: [], queries: [] })),
  getOptionalSystemFeatures: vi.fn(),
  headers: vi.fn(async () => new Headers()),
}))

vi.mock('@/service/console/server', () => ({}))

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

vi.mock('@/i18n/server', () => ({
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

  it.each([
    ['zh-CN,zh;q=0.9', 'zh-Hans', 'ltr'],
    ['ar-TN,ar;q=0.9', 'ar-TN', 'rtl'],
    ['fa-IR,fa;q=0.9', 'fa-IR', 'rtl'],
  ])(
    'renders the terminal error document in %s without console bootstrap',
    async (language, locale, direction) => {
      mocks.headers.mockResolvedValue(
        new Headers({
          'x-dify-pathname': '/webapp-unavailable',
          'accept-language': language,
        }),
      )
      const { default: RootLayout, generateMetadata } = await import('../layout')

      const html = renderToStaticMarkup(
        await RootLayout({ children: <main>App unavailable</main> }),
      )
      const document = new DOMParser().parseFromString(html, 'text/html')

      expect(document.documentElement.lang).toBe(locale)
      expect(document.documentElement.dir).toBe(direction)
      expect(document.body.querySelector('main')).toHaveTextContent('App unavailable')
      await expect(generateMetadata()).resolves.toEqual({ icons: { icon: '/favicon.ico' } })

      expect(mocks.getOptionalSystemFeatures).not.toHaveBeenCalled()
      expect(mocks.dehydrateSystemFeatures).not.toHaveBeenCalled()
    },
  )

  it('uses optional System Features for branded metadata', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue({
      branding: {
        application_title: 'Acme AI',
        enabled: true,
      },
      deployment_edition: 'CLOUD',
    })
    const { generateMetadata } = await import('../layout')

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

  it('uses default metadata when optional System Features are unavailable', async () => {
    mocks.getOptionalSystemFeatures.mockResolvedValue(undefined)
    const { generateMetadata } = await import('../layout')

    await expect(generateMetadata()).resolves.toMatchObject({
      title: {
        default: 'Dify',
        template: '%s - Dify',
      },
    })
  })
})
