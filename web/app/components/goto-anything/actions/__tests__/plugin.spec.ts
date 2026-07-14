import { pluginAction, pluginSearchQueryOptions } from '../plugin'

const serviceMocks = vi.hoisted(() => ({ queryOptions: vi.fn((options) => options) }))

vi.mock('@/service/client', () => ({
  marketplaceQuery: { searchAdvanced: { queryOptions: serviceMocks.queryOptions } },
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: vi.fn((value: Record<string, string> | string, locale: string) =>
    typeof value === 'string' ? value : value[locale] || value.en_US || '',
  ),
}))

vi.mock('../../../plugins/card/base/card-icon', () => ({ default: () => null }))
vi.mock('../../../plugins/marketplace/utils', () => ({
  getFormattedPlugin: vi.fn((plugin) => ({ ...plugin, icon: 'icon-url' })),
}))

describe('plugin search query', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes remote action metadata', () => {
    expect(pluginAction).toMatchObject({ key: '@plugin', shortcut: '@plugin', source: 'remote' })
  })

  it('builds generated marketplace query options', () => {
    pluginSearchQueryOptions('agent', 'en_US')

    expect(serviceMocks.queryOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        input: {
          params: { kind: 'plugins' },
          body: { page: 1, page_size: 10, query: 'agent' },
        },
        select: expect.any(Function),
      }),
    )
  })

  it('selects formatted plugin results using the active locale', () => {
    const options = pluginSearchQueryOptions('', 'en_US')
    const results = options.select!({
      data: {
        plugins: [
          {
            name: 'plugin-1',
            label: { en_US: 'My Plugin' },
            brief: { en_US: 'A plugin' },
            icon: 'icon.png',
          },
        ],
      },
    } as never)

    expect(results[0]).toMatchObject({ id: 'plugin-1', title: 'My Plugin', type: 'plugin' })
  })

  it('selects an empty list when marketplace returns no plugins', () => {
    const options = pluginSearchQueryOptions('', 'en_US')

    expect(options.select!({ data: {} } as never)).toEqual([])
  })
})
