// @vitest-environment node

const mocks = vi.hoisted(() => ({
  loadResource: vi.fn(),
  cookies: vi.fn(),
  headers: vi.fn(),
  getCookie: vi.fn(),
}))

vi.mock('@/next/headers', () => ({ cookies: mocks.cookies, headers: mocks.headers }))
vi.mock('../load-resource', () => ({ loadI18nResource: mocks.loadResource }))

// Unit tests have no RSC dispatcher; provide its memoization boundary here.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T extends (...args: never[]) => unknown>(factory: T) => {
    const results = new Map<string, ReturnType<T>>()
    return (...args: Parameters<T>) => {
      const key = JSON.stringify(args)
      if (!results.has(key)) results.set(key, factory(...args) as ReturnType<T>)
      return results.get(key)
    }
  },
}))

describe('server translations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.loadResource.mockImplementation(async (locale: string, namespace: string) => ({
      default:
        namespace === 'common'
          ? locale === 'en-US'
            ? { 'operation.save': 'Save', 'operation.cancel': 'Cancel' }
            : { 'operation.save': '保存' }
          : {},
    }))
  })

  it('loads resources once for concurrent consumers and reuses them after initialization', async () => {
    const { getTranslation } = await import('../server')
    const translations = await Promise.all([
      getTranslation('en-US', 'plugin'),
      getTranslation('en-US', 'app'),
      getTranslation('en-US', 'explore'),
      getTranslation('en-US', 'pluginTags'),
      getTranslation('en-US', 'common'),
    ])

    expect(translations[4].t(($) => $['operation.save'], { ns: 'common' })).toBe('Save')
    const loadedResources = mocks.loadResource.mock.calls.map(
      ([locale, namespace]) => `${locale}/${namespace}`,
    )
    expect(loadedResources.filter((resource) => resource === 'en-US/common')).toHaveLength(1)
    expect(new Set(loadedResources).size).toBe(loadedResources.length)

    mocks.loadResource.mockClear()
    const { t } = await getTranslation('en-US', 'common')
    expect(t(($) => $['operation.save'], { ns: 'common' })).toBe('Save')
    expect(mocks.loadResource).not.toHaveBeenCalled()
  })

  it('keeps fallback and cross-namespace translations available', async () => {
    const { getTranslation } = await import('../server')
    const { t } = await getTranslation('zh-Hans')

    expect(t(($) => $['operation.save'], { ns: 'common' })).toBe('保存')
    expect(t(($) => $['operation.cancel'], { ns: 'common' })).toBe('Cancel')
  })

  it('initializes the requested language independently of an earlier consumer', async () => {
    const { getTranslation } = await import('../server')
    const english = await getTranslation('en-US', 'common')
    const chinese = await getTranslation('zh-Hans', 'common')

    expect(chinese.t(($) => $['operation.save'], { ns: 'common' })).toBe('保存')
    expect(english.t(($) => $['operation.save'], { ns: 'common' })).toBe('Save')
  })
})

describe('server locale', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.getCookie.mockReturnValue(undefined)
    mocks.cookies.mockResolvedValue({ get: mocks.getCookie })
    mocks.headers.mockResolvedValue(new Headers())
  })

  it('resolves the request locale once for concurrent and subsequent consumers', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' }))
    const { getLocaleOnServer } = await import('../server')

    await expect(
      Promise.all([getLocaleOnServer(), getLocaleOnServer(), getLocaleOnServer()]),
    ).resolves.toEqual(['zh-Hans', 'zh-Hans', 'zh-Hans'])
    await expect(getLocaleOnServer()).resolves.toBe('zh-Hans')
    expect(mocks.getCookie).toHaveBeenCalledExactlyOnceWith('locale')
    expect(mocks.headers).toHaveBeenCalledOnce()
  })

  it('prefers the locale cookie over the browser language', async () => {
    mocks.getCookie.mockReturnValue({ value: 'zh-Hans' })
    mocks.headers.mockResolvedValue(new Headers({ 'accept-language': 'en-US' }))
    const { getLocaleOnServer } = await import('../server')

    await expect(getLocaleOnServer()).resolves.toBe('zh-Hans')
    expect(mocks.headers).not.toHaveBeenCalled()
  })

  it.each([undefined, 'bad value', 'zz-ZZ'])(
    'uses the default language for an absent or unusable preference: %s',
    async (locale) => {
      mocks.getCookie.mockReturnValue(locale ? { value: locale } : undefined)
      const { getLocaleOnServer } = await import('../server')

      await expect(getLocaleOnServer()).resolves.toBe('en-US')
    },
  )
})
