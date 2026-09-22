import type { SelectorParam } from 'i18next'

const mocks = vi.hoisted(() => {
  const t = vi.fn(() => 'Translated')
  const translations = { t }
  return {
    translations,
    t,
    client: vi.fn(() => translations),
    locale: vi.fn(async () => 'en-US'),
    server: vi.fn(async () => translations),
    use: vi.fn((promise: Promise<unknown>) => promise),
  }
})

vi.mock('server-only', () => ({}))
vi.mock('react-i18next', () => ({ useTranslation: mocks.client }))
vi.mock('react', () => ({ use: mocks.use }))
vi.mock('@/i18n/server', () => ({
  getLocaleOnServer: mocks.locale,
  getTranslation: mocks.server,
}))

beforeEach(() => vi.clearAllMocks())

describe('translation adapter contracts', () => {
  it.each(['common', undefined] as const)(
    'forwards the client namespace %s unchanged',
    async (ns) => {
      const { useTranslation } = await import('../lib.client')
      expect(useTranslation(ns)).toBe(mocks.translations)
      expect(mocks.client).toHaveBeenCalledExactlyOnceWith(ns)
    },
  )

  it.each(['common', undefined] as const)(
    'loads the server namespace %s with the current locale',
    async (ns) => {
      const { useTranslation } = await import('../lib.server')
      expect(await useTranslation(ns)).toBe(mocks.translations)
      expect(mocks.locale).toHaveBeenCalledTimes(1)
      expect(mocks.server).toHaveBeenCalledExactlyOnceWith('en-US', ns)
      expect(mocks.use).toHaveBeenCalledTimes(1)
    },
  )

  it('loads metadata from exactly the requested namespace and selector', async () => {
    const { getRouteMetadata } = await import('@/app/route-metadata')
    const selector: SelectorParam<'common'> = ($) => $['operation.save']
    expect(await getRouteMetadata('common', selector)).toEqual({ title: 'Translated' })
    expect(mocks.locale).toHaveBeenCalledTimes(1)
    expect(mocks.server).toHaveBeenCalledExactlyOnceWith('en-US', 'common')
    expect(mocks.t).toHaveBeenCalledExactlyOnceWith(selector, { ns: 'common' })
  })
})
