import type {
  MarketplaceCreator,
  MarketplacePlugin,
  MarketplaceTemplate,
  MarketplaceTimestamp,
} from '@dify/contracts/marketplace'
import type { Plugin } from '@/app/components/plugins/types'

export type CreatorProfileKind = 'individual' | 'organization'
export type CreatorProfileBadge = 'partner' | 'verified'
export type CreatorSocialPlatform = 'website' | 'x' | 'instagram' | 'youtube' | 'figma' | 'github'
export type CreatorSortField = 'updatedAt' | 'createdAt' | 'popularity'
export type CreatorSortOrder = 'asc' | 'desc'
export const CREATOR_SORT_FIELDS = ['updatedAt', 'createdAt', 'popularity'] as const
export const DEFAULT_CREATOR_SORT_FIELD: CreatorSortField = 'updatedAt'
export const DEFAULT_CREATOR_SORT_ORDER: CreatorSortOrder = 'desc'

export const parseCreatorSortField = (value?: string | null): CreatorSortField =>
  CREATOR_SORT_FIELDS.includes(value as CreatorSortField)
    ? (value as CreatorSortField)
    : DEFAULT_CREATOR_SORT_FIELD

export const parseCreatorSortOrder = (value?: string | null): CreatorSortOrder => {
  const normalized = value?.toLowerCase()
  return normalized === 'asc' || normalized === 'desc' ? normalized : DEFAULT_CREATOR_SORT_ORDER
}

export const toPublisherSortQuery = (field: CreatorSortField, order: CreatorSortOrder) => {
  const sort_order = order === 'asc' ? 'ASC' : 'DESC'
  return {
    plugins: {
      sort_by:
        field === 'updatedAt'
          ? 'version_updated_at'
          : field === 'createdAt'
            ? 'created_at'
            : 'install_count',
      sort_order,
    },
    templates: {
      sort_by:
        field === 'updatedAt' ? 'updated_at' : field === 'createdAt' ? 'created_at' : 'usage_count',
      sort_order,
    },
  }
}

export type CreatorSocialLink = {
  platform: CreatorSocialPlatform
  href: string
  label: string
}

export type CreatorCreationTarget =
  | {
      type: 'plugin'
      org: string
      name: string
      pluginType: MarketplacePlugin['type']
    }
  | {
      type: 'template'
      id: string
      publisher: string
      templateName: string
    }

export type CreatorCreationIcon =
  | { type: 'image'; src: string }
  | { type: 'emoji'; value: string; background?: string }

export type CreatorCreation = {
  id: string
  kind: 'plugin' | 'template'
  title: string
  description: string
  target: CreatorCreationTarget
  icon: CreatorCreationIcon
  dependencyIcons: string[]
  dependencyCount: number
  updatedAt: number
  createdAt: number
  popularity: number
}

export type CreatorProfileViewModel = {
  profile: {
    kind: CreatorProfileKind
    displayName: string
    handle: string
    description?: string
    email?: string
    avatarUrl: string
    backgroundUrl: string
    badges: CreatorProfileBadge[]
    socialLinks: CreatorSocialLink[]
  }
  creations: CreatorCreation[]
}

export type LoadedCreatorProfile = {
  viewModel: CreatorProfileViewModel
  pluginsByCreationId: Record<string, Plugin>
  templatesByCreationId: Record<string, MarketplaceTemplate>
}

export type CreatorCreationAction =
  | { type: 'link'; href: string }
  | { type: 'select'; onSelect: () => void }

export type CreatorProfileAdapterInput = {
  creator: MarketplaceCreator
  kind: CreatorProfileKind
  locale: string
  avatarUrl: string
  backgroundUrl: string
  plugins: MarketplacePlugin[]
  templates: MarketplaceTemplate[]
  resolvePluginIcon: (plugin: MarketplacePlugin) => string
  resolveTemplateIcon: (template: MarketplaceTemplate) => string
  resolveDependencyIcon: (pluginId: string) => string
}

const toTimestamp = (value?: MarketplaceTimestamp | null) => {
  if (value === undefined || value === null || value === '') return 0

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0

    // Marketplace search responses use Unix seconds, while some consumers may already
    // provide JavaScript timestamps in milliseconds.
    return Math.abs(value) < 1_000_000_000_000 ? value * 1000 : value
  }

  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export const getCreatorLocalizedText = (
  value: Partial<Record<string, string>> | string | undefined,
  locale: string,
) => {
  if (typeof value === 'string') return value
  if (!value) return ''

  const normalizedLocale = locale.replace('-', '_')
  return (
    value[locale] ||
    value[normalizedLocale] ||
    value['en-US'] ||
    value.en_US ||
    Object.values(value).find(Boolean) ||
    ''
  )
}

const getSocialPlatform = (hostname: string): CreatorSocialPlatform => {
  if (
    hostname === 'x.com' ||
    hostname.endsWith('.x.com') ||
    hostname === 'twitter.com' ||
    hostname.endsWith('.twitter.com')
  )
    return 'x'
  if (hostname === 'instagram.com' || hostname.endsWith('.instagram.com')) return 'instagram'
  if (hostname === 'youtube.com' || hostname.endsWith('.youtube.com') || hostname === 'youtu.be')
    return 'youtube'
  if (hostname === 'figma.com' || hostname.endsWith('.figma.com')) return 'figma'
  if (hostname === 'github.com' || hostname.endsWith('.github.com')) return 'github'
  return 'website'
}

export const normalizeCreatorSocialLink = (value: string): CreatorSocialLink | null => {
  const trimmedValue = value.trim()
  if (!trimmedValue) return null

  const hasScheme = /^[a-z][a-z\d+.-]*:/i.test(trimmedValue)
  if (hasScheme && !/^https?:\/\//i.test(trimmedValue)) return null

  try {
    const url = new URL(
      /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`,
    )
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null

    const hostname = url.hostname.toLowerCase().replace(/^www\./, '')
    return {
      platform: getSocialPlatform(hostname),
      href: url.toString(),
      label: trimmedValue.replace(/^https?:\/\//i, '').replace(/\/$/, ''),
    }
  } catch {
    return null
  }
}

const getCreatorBadges = (creator: MarketplaceCreator) => {
  const badges = new Set<CreatorProfileBadge>()
  if (creator.badges?.includes('partner')) badges.add('partner')
  if (creator.verified || creator.badges?.includes('verified')) badges.add('verified')
  return Array.from(badges)
}

export const adaptCreatorProfile = ({
  creator,
  kind,
  locale,
  avatarUrl,
  backgroundUrl,
  plugins,
  templates,
  resolvePluginIcon,
  resolveTemplateIcon,
  resolveDependencyIcon,
}: CreatorProfileAdapterInput): CreatorProfileViewModel => {
  const pluginCreations = plugins.map((plugin): CreatorCreation => ({
    id: `${plugin.type}:${plugin.org}/${plugin.name}`,
    kind: 'plugin',
    title: getCreatorLocalizedText(plugin.labels ?? plugin.label, locale) || plugin.name,
    description:
      getCreatorLocalizedText(
        plugin.type === 'bundle' ? plugin.description : plugin.brief,
        locale,
      ) ||
      plugin.introduction ||
      '',
    target: {
      type: 'plugin',
      org: plugin.org,
      name: plugin.name,
      pluginType: plugin.type,
    },
    icon: { type: 'image', src: resolvePluginIcon(plugin) },
    dependencyIcons: [],
    dependencyCount: 0,
    updatedAt: toTimestamp(plugin.version_updated_at || plugin.updated_at),
    createdAt: toTimestamp(plugin.created_at),
    popularity: plugin.install_count || 0,
  }))

  const templateCreations = templates.map((template): CreatorCreation => {
    const templateIcon = resolveTemplateIcon(template)
    const dependencyIds = template.deps_plugins ?? []
    const publisher =
      template.publisher_handle ||
      template.publisher_unique_handle ||
      template.creator_email ||
      'template'

    return {
      id: `template:${template.id}`,
      kind: 'template',
      title: template.template_name,
      description: template.overview || '',
      target: {
        type: 'template',
        id: template.id,
        publisher,
        templateName: template.template_name,
      },
      icon: templateIcon
        ? { type: 'image', src: templateIcon }
        : { type: 'emoji', value: template.icon || '📄', background: template.icon_background },
      dependencyIcons: dependencyIds.map(resolveDependencyIcon),
      dependencyCount: dependencyIds.length,
      updatedAt: toTimestamp(template.updated_at),
      createdAt: toTimestamp(template.created_at),
      popularity: template.usage_count || 0,
    }
  })

  return {
    profile: {
      kind,
      displayName: creator.display_name || creator.name || creator.unique_handle,
      handle: creator.unique_handle,
      description: creator.description || undefined,
      email: creator.display_email || creator.email || undefined,
      avatarUrl,
      backgroundUrl,
      badges: getCreatorBadges(creator),
      socialLinks: (creator.social_links ?? [])
        .map(normalizeCreatorSocialLink)
        .filter((link): link is CreatorSocialLink => link !== null),
    },
    creations: [...pluginCreations, ...templateCreations],
  }
}

export const sortCreatorCreations = (
  creations: CreatorCreation[],
  field: CreatorSortField,
  order: CreatorSortOrder,
) => {
  const direction = order === 'asc' ? 1 : -1
  return creations
    .map((creation, index) => ({ creation, index }))
    .sort((left, right) => {
      const difference = (left.creation[field] - right.creation[field]) * direction
      return difference || left.index - right.index
    })
    .map(({ creation }) => creation)
}

export const getStandaloneCreationHref = (creation: CreatorCreation, locale?: string) => {
  const language = locale ? `language=${encodeURIComponent(locale)}` : ''
  if (creation.target.type === 'plugin') {
    const resource = creation.target.pluginType === 'bundle' ? 'bundles' : 'plugin'
    const path = `/${resource}/${encodeURIComponent(creation.target.org)}/${encodeURIComponent(creation.target.name)}`
    return language ? `${path}?${language}` : path
  }

  const params = new URLSearchParams({
    templateId: creation.target.id,
    creationType: 'templates',
  })
  if (locale) params.set('language', locale)
  return `/template/${encodeURIComponent(creation.target.publisher)}/${encodeURIComponent(creation.target.templateName)}?${params.toString()}`
}
