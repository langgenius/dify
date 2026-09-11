// @vitest-environment node

const mocks = vi.hoisted(() => ({ loadResource: vi.fn() }))

vi.mock('@/next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))
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
