import { beforeEach, describe, expect, it, vi } from 'vitest'
import { marketplaceClient } from '@/service/client'
import { fetchPluginRecommendBanners } from './banners'

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    banners: {
      list: vi.fn(),
    },
  },
}))

const mockedListBanners = vi.mocked(marketplaceClient.banners.list)

describe('fetchPluginRecommendBanners', () => {
  beforeEach(() => {
    mockedListBanners.mockReset()
  })

  it('normalizes, sorts, and limits recommend banners from the public contract', async () => {
    mockedListBanners.mockResolvedValue({
      code: 0,
      msg: 'success',
      data: {
        banners: [
          {
            id: 'event',
            style_type: 'event',
            title: 'Event',
            sort: 0,
            language: 'en',
            content: {},
          },
          {
            id: 'recommend-2',
            style_type: 'recommend',
            title: 'Second',
            sort: 2,
            language: 'en',
            content: {
              cards: [
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/fifth',
                  display_name: 'Fifth',
                  link: '/plugins/langgenius/fifth',
                  card_position: 4,
                },
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/first',
                  display_name: 'First',
                  icon_url: '/api/v1/plugins/langgenius/first/icon',
                  link: '/plugins/langgenius/first',
                  card_position: 0,
                },
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/third',
                  display_name: 'Third',
                  link: '/plugins/langgenius/third',
                  card_position: 2,
                },
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/second',
                  display_name: 'Second',
                  link: '/plugins/langgenius/second',
                  card_position: 1,
                },
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/fourth',
                  display_name: 'Fourth',
                  link: '/plugins/langgenius/fourth',
                  card_position: 3,
                },
              ],
            },
          },
          {
            id: 'recommend-1',
            style_type: 'recommend',
            title: 'First',
            sort: 1,
            language: 'en',
            content: {
              cards: [
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/agent',
                  display_name: 'Agent',
                  link: '/plugins/langgenius/agent',
                  card_position: 0,
                },
              ],
            },
          },
        ],
      },
    })

    const banners = await fetchPluginRecommendBanners('en-US')

    expect(mockedListBanners).toHaveBeenCalledWith({
      query: {
        page: 'plugins',
        language: 'en-US',
      },
    })
    expect(banners.map(banner => banner.id)).toEqual(['recommend-1', 'recommend-2'])
    expect(banners[1]!.content.cards.map(card => card.display_name))
      .toEqual(['First', 'Second', 'Third', 'Fourth'])
  })

  it('returns no banners for an empty response', async () => {
    mockedListBanners.mockResolvedValue('')

    await expect(fetchPluginRecommendBanners('en-US')).resolves.toEqual([])
  })
})
