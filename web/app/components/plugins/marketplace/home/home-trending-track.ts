import type { BannerRecommendCard, PluginBanner } from '@dify/contracts/marketplace'

const CLICK_TARGET_BY_STYLE = {
  recommend: 'recommendation',
  blog: 'blog',
  event: 'event',
  ad: 'ad',
} as const

const THEME_TYPE_BY_BANNER = {
  newest: 'new_arrivals',
  hottest: 'most_popular',
  partner: 'partner',
} as const

export type MarketplaceBannerCardClick = Pick<
  BannerRecommendCard,
  'item_id' | 'item_type' | 'display_name'
> & {
  link: string
}

const compact = (properties: Record<string, unknown>) => {
  const next: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(properties)) {
    if (value !== undefined && value !== '') next[key] = value
  }
  return next
}

export const buildMarketplaceBannerClickProperties = (
  banner: PluginBanner,
  cardClick?: MarketplaceBannerCardClick,
) => {
  const clickTarget = CLICK_TARGET_BY_STYLE[banner.style_type]
  const properties: Record<string, unknown> = {
    banner_id: banner.id,
    title: banner.title,
    click_target: clickTarget,
    sort: banner.sort,
    language: banner.language,
    link: cardClick?.link ?? (banner.style_type === 'recommend' ? undefined : banner.content.link),
  }

  if (banner.style_type === 'recommend') {
    properties.theme_type = THEME_TYPE_BY_BANNER[banner.content.theme_type]
    properties.item_id = cardClick?.item_id
    properties.item_type = cardClick?.item_type
    properties.item_name = cardClick?.display_name
  }

  if (banner.style_type === 'blog') properties.target_type = banner.content.link_target_type

  if (banner.style_type === 'event') properties.activity_id = banner.content.activity_id

  if (banner.style_type === 'ad') {
    properties.partner_id = banner.content.partner_id
    properties.campaign_id = banner.content.campaign_id
  }

  return compact(properties)
}
