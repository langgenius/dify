import { marketplaceClient } from '@/service/client'

const MAX_CARDS_PER_PAGE = 4

type BannerBase = {
  id: string
  title: string
  sort: number
  language: string
}

export type BannerRecommendCard = {
  item_type: 'plugin' | 'template'
  item_id: string
  display_name: string
  icon_url?: string
  icon?: string
  icon_background?: string
  creator?: string
  badges?: Array<'partner' | 'verified'>
  link: string
  card_position: number
}

export type BannerRecommend = BannerBase & {
  style_type: 'recommend'
  content: {
    theme_type: 'newest' | 'hottest' | 'partner'
    heading?: string
    subheadings?: string[]
    description?: string
    cards: BannerRecommendCard[]
  }
}

export type BannerBlog = BannerBase & {
  style_type: 'blog'
  content: {
    blog_title: string
    subtitle?: string
    description?: string
    link: string
    link_target_type: 'blog' | 'github'
  }
}

type BannerImageContent = {
  images: {
    desktop: string
    tablet?: string
    mobile?: string
  }
  link: string
  alt_text?: string
  activity_id?: string
}

export type BannerEvent = BannerBase & {
  style_type: 'event'
  content: BannerImageContent
}

export type BannerAd = BannerBase & {
  style_type: 'ad'
  content: BannerImageContent & {
    partner_id?: string
    campaign_id?: string
  }
}

export type PluginBanner = BannerRecommend | BannerBlog | BannerEvent | BannerAd

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const parseBannerBase = (value: Record<string, unknown>): BannerBase | null => {
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.title !== 'string' ||
    !value.title ||
    typeof value.sort !== 'number' ||
    typeof value.language !== 'string' ||
    !value.language
  ) {
    return null
  }

  return {
    id: value.id,
    title: value.title,
    sort: value.sort,
    language: value.language,
  }
}

const parseRecommendCard = (value: unknown): BannerRecommendCard | null => {
  if (!isRecord(value)) return null

  const itemType = value.item_type
  const itemId = value.item_id
  const displayName = value.display_name
  if (
    (itemType !== 'plugin' && itemType !== 'template') ||
    typeof itemId !== 'string' ||
    !itemId ||
    typeof displayName !== 'string' ||
    !displayName
  ) {
    return null
  }

  const badges = Array.isArray(value.badges)
    ? value.badges.filter(
        (badge): badge is 'partner' | 'verified' => badge === 'partner' || badge === 'verified',
      )
    : undefined

  return {
    item_type: itemType,
    item_id: itemId,
    display_name: displayName,
    icon_url: typeof value.icon_url === 'string' ? value.icon_url : undefined,
    icon: typeof value.icon === 'string' ? value.icon : undefined,
    icon_background: typeof value.icon_background === 'string' ? value.icon_background : undefined,
    creator: typeof value.creator === 'string' ? value.creator : undefined,
    badges,
    link: typeof value.link === 'string' ? value.link : '',
    card_position: typeof value.card_position === 'number' ? value.card_position : 0,
  }
}

const parseRecommendBanner = (
  base: BannerBase,
  content: Record<string, unknown>,
): BannerRecommend | null => {
  const themeType = content.theme_type
  if (themeType !== 'newest' && themeType !== 'hottest' && themeType !== 'partner') return null

  const cards = Array.isArray(content.cards)
    ? content.cards
        .map(parseRecommendCard)
        .filter((card): card is BannerRecommendCard => Boolean(card))
        .sort((a, b) => a.card_position - b.card_position)
        .slice(0, MAX_CARDS_PER_PAGE)
    : []

  if (cards.length === 0) return null

  const subheadings = Array.isArray(content.subheadings)
    ? content.subheadings.filter((item): item is string => typeof item === 'string')
    : undefined

  return {
    ...base,
    style_type: 'recommend',
    content: {
      theme_type: themeType,
      heading: typeof content.heading === 'string' ? content.heading : undefined,
      subheadings,
      description: typeof content.description === 'string' ? content.description : undefined,
      cards,
    },
  }
}

const parseBlogBanner = (base: BannerBase, content: Record<string, unknown>): BannerBlog | null => {
  const linkTargetType = content.link_target_type
  if (
    typeof content.blog_title !== 'string' ||
    !content.blog_title ||
    typeof content.link !== 'string' ||
    !content.link ||
    (linkTargetType !== 'blog' && linkTargetType !== 'github')
  ) {
    return null
  }

  return {
    ...base,
    style_type: 'blog',
    content: {
      blog_title: content.blog_title,
      subtitle: typeof content.subtitle === 'string' ? content.subtitle : undefined,
      description: typeof content.description === 'string' ? content.description : undefined,
      link: content.link,
      link_target_type: linkTargetType,
    },
  }
}

const parseImageBanner = (
  base: BannerBase,
  styleType: 'event' | 'ad',
  content: Record<string, unknown>,
): BannerEvent | BannerAd | null => {
  if (
    !isRecord(content.images) ||
    typeof content.images.desktop !== 'string' ||
    !content.images.desktop ||
    typeof content.link !== 'string' ||
    !content.link
  ) {
    return null
  }

  const imageContent: BannerImageContent = {
    images: {
      desktop: content.images.desktop,
      tablet:
        typeof content.images.tablet === 'string' && content.images.tablet
          ? content.images.tablet
          : undefined,
      mobile:
        typeof content.images.mobile === 'string' && content.images.mobile
          ? content.images.mobile
          : undefined,
    },
    link: content.link,
    alt_text: typeof content.alt_text === 'string' ? content.alt_text : undefined,
    activity_id: typeof content.activity_id === 'string' ? content.activity_id : undefined,
  }

  if (styleType === 'event') {
    return {
      ...base,
      style_type: 'event',
      content: imageContent,
    }
  }

  return {
    ...base,
    style_type: 'ad',
    content: {
      ...imageContent,
      partner_id: typeof content.partner_id === 'string' ? content.partner_id : undefined,
      campaign_id: typeof content.campaign_id === 'string' ? content.campaign_id : undefined,
    },
  }
}

const parsePluginBanner = (value: unknown): PluginBanner | null => {
  if (!isRecord(value) || !isRecord(value.content)) return null

  const base = parseBannerBase(value)
  if (!base) return null

  switch (value.style_type) {
    case 'recommend':
      return parseRecommendBanner(base, value.content)
    case 'blog':
      return parseBlogBanner(base, value.content)
    case 'event':
    case 'ad':
      return parseImageBanner(base, value.style_type, value.content)
    default:
      return null
  }
}

export const normalizePluginBanners = (response: unknown): PluginBanner[] => {
  if (!isRecord(response) || !isRecord(response.data) || !Array.isArray(response.data.banners))
    return []

  return response.data.banners
    .map(parsePluginBanner)
    .filter((banner): banner is PluginBanner => Boolean(banner))
    .sort((a, b) => a.sort - b.sort)
}

export const fetchPluginBanners = async (language: string): Promise<PluginBanner[]> => {
  const response = await marketplaceClient.banners.list({
    query: {
      page: 'plugins',
      language,
    },
  })

  return normalizePluginBanners(response)
}
