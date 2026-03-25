import { pluginAction } from '../plugin'

vi.mock('@/service/base', () => ({
  postMarketplace: vi.fn(),
}))

vi.mock('@/i18n-config', () => ({
  renderI18nObject: vi.fn((obj: Record<string, string> | string, locale: string) => {
    if (typeof obj === 'string')
      return obj
    return obj[locale] || obj.en_US || ''
  }),
}))

vi.mock('../../../plugins/card/base/card-icon', () => ({
  default: () => null,
}))

vi.mock('../../../plugins/marketplace/utils', () => ({
  getPluginIconInMarketplace: vi.fn(() => 'icon-url'),
}))

describe('pluginAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('has correct metadata', () => {
    expect(pluginAction.key).toBe('@plugin')
    expect(pluginAction.shortcut).toBe('@plugin')
  })

  it('returns parsed plugin results on success', async () => {
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockResolvedValue({
      data: {
        plugins: [
          { name: 'plugin-1', label: { en_US: 'My Plugin' }, brief: { en_US: 'A plugin' }, icon: 'icon.png' },
        ],
        total: 1,
      },
    })

    const results = await pluginAction.search('@plugin', 'test', 'en_US')

    expect(postMarketplace).toHaveBeenCalledWith('/plugins/search/advanced', {
      body: { page: 1, page_size: 10, query: 'test', type: 'plugin' },
    })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 'plugin-1',
      title: 'My Plugin',
      type: 'plugin',
    })
  })

  it('returns empty array when response has unexpected structure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockResolvedValue({ data: {} })

    const results = await pluginAction.search('@plugin', 'test', 'en')
    expect(results).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith(
      'Plugin search: Unexpected response structure',
      expect.anything(),
    )
    warnSpy.mockRestore()
  })

  it('returns empty array on API failure', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { postMarketplace } = await import('@/service/base')
    vi.mocked(postMarketplace).mockRejectedValue(new Error('fail'))

    const results = await pluginAction.search('@plugin', 'fail', 'en')
    expect(results).toEqual([])
    expect(warnSpy).toHaveBeenCalledWith('Plugin search failed:', expect.any(Error))
    warnSpy.mockRestore()
  })
})
