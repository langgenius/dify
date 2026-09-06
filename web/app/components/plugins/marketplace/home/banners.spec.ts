import { beforeEach, describe, expect, it, vi } from 'vitest'
import { marketplaceClient } from '@/service/client'
import { fetchPluginBanners } from './banners'

vi.mock('@/service/client', () => ({
  marketplaceClient: {
    banners: {
      list: vi.fn(),
    },
  },
}))

const mockedListBanners = vi.mocked(marketplaceClient.banners.list)

describe('fetchPluginBanners', () => {
  beforeEach(() => {
    mockedListBanners.mockReset()
  })

  it('normalizes every public banner style in API sort order', async () => {
    mockedListBanners.mockResolvedValue({
      code: 0,
      msg: 'success',
      data: {
        banners: [
          {
            id: 'event',
            style_type: 'event',
            title: 'Dify Event',
            sort: 3,
            language: 'en',
            content: {
              images: {
                desktop: '/api/v1/banners/images/banners/event.png',
                mobile: '/api/v1/banners/images/banners/event-mobile.png',
              },
              link: 'https://dify.ai/events',
              alt_text: 'Dify Event',
              activity_id: 'event-1',
            },
          },
          {
            id: 'recommend',
            style_type: 'recommend',
            title: 'Trending Now',
            sort: 1,
            language: 'en',
            content: {
              theme_type: 'hottest',
              heading: 'Popular plugins',
              description: 'Chosen from real usage.',
              cards: [
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/fourth',
                  display_name: 'Fourth',
                  link: '/plugins/langgenius/fourth',
                  card_position: 3,
                },
                {
                  item_type: 'plugin',
                  item_id: 'langgenius/first',
                  display_name: 'First',
                  icon_url: '/api/v1/plugins/langgenius/first/icon',
                  creator: 'langgenius',
                  badges: ['verified', 'partner', 'unknown'],
                  link: '/plugins/langgenius/first',
                  card_position: 0,
                  auto_batch_id: '11111111-1111-4111-8111-111111111111',
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
              ],
            },
          },
          {
            id: 'ad',
            style_type: 'ad',
            title: 'Partner campaign',
            sort: 4,
            language: 'en',
            content: {
              images: {
                desktop: '/api/v1/banners/images/banners/ad.webp',
              },
              link: 'https://example.com',
              partner_id: 'partner-1',
              campaign_id: 'campaign-1',
            },
          },
          {
            id: 'blog',
            style_type: 'blog',
            title: 'Dify Updates',
            sort: 2,
            language: 'en',
            content: {
              blog_title: 'Dify v1.9 new launch',
              subtitle: 'New Agent node support',
              description: 'Build agent workflows with the new Agent node.',
              link: 'https://dify.ai/blog',
              link_target_type: 'blog',
            },
          },
          {
            id: 'unsupported',
            style_type: 'popup',
            title: 'Unsupported',
            sort: 0,
            language: 'en',
            content: {},
          },
        ],
      },
    })

    const banners = await fetchPluginBanners('en-US')

    expect(mockedListBanners).toHaveBeenCalledWith({
      query: {
        page: 'plugins',
        language: 'en-US',
      },
    })
    expect(banners.map((banner) => banner.id)).toEqual(['recommend', 'blog', 'event', 'ad'])

    const recommend = banners[0]
    expect(recommend?.style_type).toBe('recommend')
    if (recommend?.style_type === 'recommend') {
      expect(recommend.content.cards.map((card) => card.display_name)).toEqual([
        'First',
        'Second',
        'Third',
        'Fourth',
      ])
      expect(recommend.content.cards[0]).toMatchObject({
        creator: 'langgenius',
        badges: ['verified', 'partner'],
        auto_batch_id: '11111111-1111-4111-8111-111111111111',
      })
    }

    const event = banners[2]
    expect(event?.style_type).toBe('event')
    if (event?.style_type === 'event') {
      expect(event.content.images).toEqual({
        desktop: '/api/v1/banners/images/banners/event.png',
        mobile: '/api/v1/banners/images/banners/event-mobile.png',
      })
    }
  })

  it('drops malformed banners and returns no placeholders for an empty response', async () => {
    mockedListBanners
      .mockResolvedValueOnce({
        data: {
          banners: [
            {
              id: 'empty-recommend',
              style_type: 'recommend',
              title: 'Empty',
              sort: 0,
              language: 'en',
              content: {
                theme_type: 'hottest',
                cards: [],
              },
            },
            {
              id: 'event-without-desktop',
              style_type: 'event',
              title: 'Broken',
              sort: 1,
              language: 'en',
              content: {
                images: {
                  mobile: '/api/v1/banners/images/banners/mobile.png',
                },
                link: 'https://example.com',
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce('')

    await expect(fetchPluginBanners('en-US')).resolves.toEqual([])
    await expect(fetchPluginBanners('en-US')).resolves.toEqual([])
  })

  it('requests templates banners when fetching for the templates page', async () => {
    mockedListBanners.mockResolvedValue({
      data: {
        banners: [],
      },
    })

    await expect(fetchPluginBanners('en-US', 'templates')).resolves.toEqual([])
    expect(mockedListBanners).toHaveBeenCalledWith({
      query: {
        page: 'templates',
        language: 'en-US',
      },
    })
  })
})
