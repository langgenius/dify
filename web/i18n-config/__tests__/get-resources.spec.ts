// @vitest-environment node

const mocks = vi.hoisted(() => ({
  loadResource: vi.fn(),
}))

vi.mock('../load-resource', () => ({ loadI18nResource: mocks.loadResource }))

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

describe('getResourcesForPath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    mocks.loadResource.mockResolvedValue({ default: {} })
  })

  it('loads fewer namespaces for lightweight routes than the full registry', async () => {
    const { getResourcesForPath } = await import('../server')
    await getResourcesForPath('en-US', '/apps')

    expect(mocks.loadResource.mock.calls.length).toBeLessThan(38)
    expect(mocks.loadResource.mock.calls.some(([, ns]) => ns === 'common')).toBe(true)
    expect(mocks.loadResource.mock.calls.some(([, ns]) => ns === 'workflow')).toBe(false)
  })

  it('loads dataset namespaces for datasets routes', async () => {
    const { getResourcesForPath } = await import('../server')
    await getResourcesForPath('en-US', '/datasets')

    expect(mocks.loadResource.mock.calls.some(([, ns]) => ns === 'dataset')).toBe(true)
    expect(mocks.loadResource.mock.calls.some(([, ns]) => ns === 'workflow')).toBe(false)
  })
})
