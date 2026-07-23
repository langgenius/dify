import { marketplaceClient } from '@/service/client'

const MAX_TRENDING_PAGES = 3
const MAX_CARDS_PER_PAGE = 4

export type BannerRecommendCard = {
  item_type: 'plugin' | 'template'
  item_id: string
  display_name: string
  icon_url?: string
  icon?: string
  icon_background?: string
  link: string
  card_position: number
}

export type BannerRecommend = {
  id: string
  style_type: 'recommend'
  title: string
  sort: number
  language: string
  content: {
    theme_type?: string
    heading?: string
    subheadings?: string[]
    description?: string
    cards: BannerRecommendCard[]
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const parseRecommendCard = (value: unknown): BannerRecommendCard | null => {
  if (!isRecord(value))
    return null

  const itemType = value.item_type
  const itemId = value.item_id
  const displayName = value.display_name
  if (
    (itemType !== 'plugin' && itemType !== 'template')
    || typeof itemId !== 'string'
    || !itemId
    || typeof displayName !== 'string'
    || !displayName
  ) {
    return null
  }

  return {
    item_type: itemType,
    item_id: itemId,
    display_name: displayName,
    icon_url: typeof value.icon_url === 'string' ? value.icon_url : undefined,
    icon: typeof value.icon === 'string' ? value.icon : undefined,
    icon_background: typeof value.icon_background === 'string' ? value.icon_background : undefined,
    link: typeof value.link === 'string' ? value.link : '',
    card_position: typeof value.card_position === 'number' ? value.card_position : 0,
  }
}

const parseRecommendBanner = (value: unknown): BannerRecommend | null => {
  if (!isRecord(value) || value.style_type !== 'recommend' || !isRecord(value.content))
    return null

  const cards = Array.isArray(value.content.cards)
    ? value.content.cards
        .map(parseRecommendCard)
        .filter((card): card is BannerRecommendCard => Boolean(card))
        .sort((a, b) => a.card_position - b.card_position)
        .slice(0, MAX_CARDS_PER_PAGE)
    : []

  if (
    typeof value.id !== 'string'
    || typeof value.title !== 'string'
    || typeof value.sort !== 'number'
    || typeof value.language !== 'string'
    || cards.length === 0
  ) {
    return null
  }

  const subheadings = Array.isArray(value.content.subheadings)
    ? value.content.subheadings.filter((item): item is string => typeof item === 'string')
    : undefined

  return {
    id: value.id,
    style_type: 'recommend',
    title: value.title,
    sort: value.sort,
    language: value.language,
    content: {
      theme_type: typeof value.content.theme_type === 'string' ? value.content.theme_type : undefined,
      heading: typeof value.content.heading === 'string' ? value.content.heading : undefined,
      subheadings,
      description: typeof value.content.description === 'string' ? value.content.description : undefined,
      cards,
    },
  }
}

export const normalizePluginRecommendBanners = (response: unknown): BannerRecommend[] => {
  if (!isRecord(response) || !isRecord(response.data) || !Array.isArray(response.data.banners))
    return []

  return response.data.banners
    .map(parseRecommendBanner)
    .filter((banner): banner is BannerRecommend => Boolean(banner))
    .sort((a, b) => a.sort - b.sort)
    .slice(0, MAX_TRENDING_PAGES)
}

export const fetchPluginRecommendBanners = async (language: string): Promise<BannerRecommend[]> => {
  const response = await marketplaceClient.banners.list({
    query: {
      page: 'plugins',
      language,
    },
  })

  return normalizePluginRecommendBanners(response)
}
