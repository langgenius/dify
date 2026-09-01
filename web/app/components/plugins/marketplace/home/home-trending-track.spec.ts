import type { PluginBanner } from '@dify/contracts/marketplace'
import { describe, expect, it } from 'vitest'
import { buildMarketplaceBannerClickProperties } from './home-trending-track'

const recommendBanner: PluginBanner = {
  id: 'banner-recommend',
  style_type: 'recommend',
  title: 'Trending',
  sort: 0,
  language: 'en',
  content: {
    theme_type: 'hottest',
    cards: [],
  },
}

describe('buildMarketplaceBannerClickProperties', () => {
  it('maps a recommendation card click to the site-event payload', () => {
    expect(
      buildMarketplaceBannerClickProperties(recommendBanner, {
        item_id: 'langgenius/dropbox',
        item_type: 'plugin',
        link: '/plugin/langgenius/dropbox',
      }),
    ).toEqual({
      banner_id: 'banner-recommend',
      title: 'Trending',
      theme_type: 'most_popular',
      click_target: 'recommendation',
      sort: 0,
      language: 'en',
      item_id: 'langgenius/dropbox',
      item_type: 'plugin',
      link: '/plugin/langgenius/dropbox',
    })
  })

  it('maps newest recommendation theme to new_arrivals', () => {
    expect(
      buildMarketplaceBannerClickProperties(
        {
          ...recommendBanner,
          content: { theme_type: 'newest', cards: [] },
        },
        {
          item_id: 'tpl-1',
          item_type: 'template',
          link: '/templates?tid=tpl-1',
        },
      ),
    ).toMatchObject({
      theme_type: 'new_arrivals',
      click_target: 'recommendation',
      item_id: 'tpl-1',
      item_type: 'template',
    })
  })

  it('reports blog frame clicks with target_type and without card fields', () => {
    expect(
      buildMarketplaceBannerClickProperties({
        id: 'banner-blog',
        style_type: 'blog',
        title: 'Dify Updates',
        sort: 1,
        language: 'zh',
        content: {
          blog_title: 'Launch',
          link: 'https://dify.ai/blog',
          link_target_type: 'github',
        },
      }),
    ).toEqual({
      banner_id: 'banner-blog',
      title: 'Dify Updates',
      click_target: 'blog',
      sort: 1,
      language: 'zh',
      target_type: 'github',
      link: 'https://dify.ai/blog',
    })
  })

  it('reports event frame clicks with activity_id only', () => {
    expect(
      buildMarketplaceBannerClickProperties({
        id: 'banner-event',
        style_type: 'event',
        title: 'Meetup',
        sort: 2,
        language: 'ja',
        content: {
          images: { desktop: '/event.png' },
          link: 'https://dify.ai/events',
          activity_id: 'act-1',
        },
      }),
    ).toEqual({
      banner_id: 'banner-event',
      title: 'Meetup',
      click_target: 'event',
      sort: 2,
      language: 'ja',
      activity_id: 'act-1',
      link: 'https://dify.ai/events',
    })
  })

  it('reports ad frame clicks with partner and campaign ids', () => {
    expect(
      buildMarketplaceBannerClickProperties({
        id: 'banner-ad',
        style_type: 'ad',
        title: 'Partner',
        sort: 3,
        language: 'en',
        content: {
          images: { desktop: '/ad.png' },
          link: 'https://partner.example',
          partner_id: 'acme',
          campaign_id: 'spring',
        },
      }),
    ).toEqual({
      banner_id: 'banner-ad',
      title: 'Partner',
      click_target: 'ad',
      sort: 3,
      language: 'en',
      partner_id: 'acme',
      campaign_id: 'spring',
      link: 'https://partner.example',
    })
  })
})
