import type { NewKnowledgeSourceDraft, NewKnowledgeSourceType } from './create/source-draft'
import type { DataSourceItem } from '@/app/components/workflow/block-selector/types'

type Datasource = DataSourceItem['declaration']['datasources'][number]

type RecommendedProvider = {
  aliases: string[]
  fallbackIcon: string
  label: string
  packageId: string
  providerType: DataSourceItem['declaration']['provider_type']
  sourceType: NewKnowledgeSourceType
}

export type InstalledSourceProviderOption = {
  datasource: Datasource
  fallbackIcon: string
  installed: true
  key: string
  label: string
  packageId: string
  plugin: DataSourceItem
  providerType: DataSourceItem['declaration']['provider_type']
  sourceType: NewKnowledgeSourceType
}

export type UninstalledSourceProviderOption = {
  fallbackIcon: string
  installed: false
  key: string
  label: string
  packageId: string
  providerType: DataSourceItem['declaration']['provider_type']
  sourceType: NewKnowledgeSourceType
}

export type SourceProviderOption = InstalledSourceProviderOption | UninstalledSourceProviderOption

const recommendedProviders: RecommendedProvider[] = [
  {
    aliases: ['firecrawl', 'plugin-daemon-website', 'plugin-daemon-website-firecrawl'],
    fallbackIcon: 'i-custom-public-common-firecrawl',
    label: 'Firecrawl',
    packageId: 'langgenius/firecrawl_datasource',
    providerType: 'website_crawl',
    sourceType: 'websiteCrawl',
  },
  {
    aliases: ['jina', 'jina reader', 'jinareader'],
    fallbackIcon: 'i-custom-public-llm-jina',
    label: 'Jina Reader',
    packageId: 'langgenius/jina_datasource',
    providerType: 'website_crawl',
    sourceType: 'websiteCrawl',
  },
  {
    aliases: ['watercrawl'],
    fallbackIcon: 'i-custom-public-knowledge-watercrawl',
    label: 'WaterCrawl',
    packageId: 'watercrawl/watercrawl_datasource',
    providerType: 'website_crawl',
    sourceType: 'websiteCrawl',
  },
  {
    aliases: ['notion', 'notion_datasource'],
    fallbackIcon: 'i-custom-public-common-notion',
    label: 'Notion',
    packageId: 'langgenius/notion_datasource',
    providerType: 'online_document',
    sourceType: 'onlineDocuments',
  },
  {
    aliases: ['google docs', 'googledocs', 'google drive', 'googledrive'],
    fallbackIcon: 'i-ri-file-text-fill text-[#4d8bf5]',
    label: 'Google Docs',
    packageId: 'langgenius/google_drive',
    providerType: 'online_drive',
    sourceType: 'onlineDocuments',
  },
  {
    aliases: ['confluence'],
    fallbackIcon: 'i-custom-public-common-confluence',
    label: 'Confluence',
    packageId: 'langgenius/confluence_datasource',
    providerType: 'online_document',
    sourceType: 'onlineDocuments',
  },
  {
    aliases: ['google drive', 'googledrive'],
    fallbackIcon: 'i-custom-public-common-google-drive',
    label: 'Google Drive',
    packageId: 'langgenius/google_drive',
    providerType: 'online_drive',
    sourceType: 'onlineDrive',
  },
  {
    aliases: ['onedrive', 'microsoft onedrive'],
    fallbackIcon: 'i-logos-microsoft-onedrive',
    label: 'OneDrive',
    packageId: 'langgenius/onedrive_datasource',
    providerType: 'online_drive',
    sourceType: 'onlineDrive',
  },
  {
    aliases: ['amazon s3', 'amazons3', 'aws s3', 's3'],
    fallbackIcon: 'i-logos-aws-s3',
    label: 'Amazon S3',
    packageId: 'langgenius/aws_s3_storage',
    providerType: 'online_drive',
    sourceType: 'onlineDrive',
  },
]

export function normalizeSourceProviderName(value: string) {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function sourceProviderPresentation(
  value: string,
  sourceType?: NewKnowledgeSourceType,
): Pick<RecommendedProvider, 'fallbackIcon' | 'label'> | undefined {
  const normalized = normalizeSourceProviderName(value)
  if (!normalized) return undefined

  const candidates = sourceType
    ? recommendedProviders.filter((provider) => provider.sourceType === sourceType)
    : recommendedProviders
  const provider =
    (!sourceType
      ? candidates.find((candidate) => normalizeSourceProviderName(candidate.label) === normalized)
      : undefined) ??
    candidates.find((candidate) =>
      [candidate.label, candidate.packageId, ...candidate.aliases]
        .map(normalizeSourceProviderName)
        .includes(normalized),
    )

  if (!provider) return undefined
  return { fallbackIcon: provider.fallbackIcon, label: provider.label }
}

function providerKey(
  sourceType: NewKnowledgeSourceType,
  plugin: DataSourceItem,
  datasource: Datasource,
) {
  return `${sourceType}:${plugin.plugin_id}:${plugin.provider}:${datasource.identity.name}`
}

function datasourceMatchesAliases(
  plugin: DataSourceItem,
  datasource: Datasource,
  aliases: string[],
) {
  const normalizedAliases = aliases.map(normalizeSourceProviderName)
  return [
    plugin.declaration.identity.label.en_US,
    plugin.declaration.identity.name,
    plugin.provider,
    datasource.identity.label.en_US,
    datasource.identity.name,
    datasource.identity.provider,
  ]
    .map(normalizeSourceProviderName)
    .some((identity) =>
      normalizedAliases.some((alias) => identity.includes(alias) || alias.includes(identity)),
    )
}

function installedRecommendedProvider(
  definition: RecommendedProvider,
  datasourcePlugins: DataSourceItem[],
): InstalledSourceProviderOption | undefined {
  const plugin = datasourcePlugins.find(
    (candidate) =>
      candidate.plugin_id === definition.packageId &&
      candidate.declaration.provider_type === definition.providerType,
  )
  if (!plugin) return undefined
  const datasource =
    plugin.declaration.datasources.find((candidate) =>
      datasourceMatchesAliases(plugin, candidate, definition.aliases),
    ) ?? plugin.declaration.datasources[0]
  if (!datasource) return undefined
  return {
    datasource,
    fallbackIcon: definition.fallbackIcon,
    installed: true,
    key: providerKey(definition.sourceType, plugin, datasource),
    label: definition.label,
    packageId: definition.packageId,
    plugin,
    providerType: definition.providerType,
    sourceType: definition.sourceType,
  }
}

function sourceTypeForProviderType(
  providerType: DataSourceItem['declaration']['provider_type'],
): NewKnowledgeSourceType | undefined {
  if (providerType === 'website_crawl') return 'websiteCrawl'
  if (providerType === 'online_document') return 'onlineDocuments'
  if (providerType === 'online_drive') return 'onlineDrive'
  return undefined
}

function fallbackIcon(sourceType: NewKnowledgeSourceType) {
  if (sourceType === 'websiteCrawl') return 'i-ri-global-line'
  if (sourceType === 'onlineDocuments') return 'i-ri-file-text-line'
  return 'i-ri-hard-drive-3-line'
}

function uniqueLabel(label: string, pluginLabel: string, labels: Set<string>) {
  if (!labels.has(label)) return label
  const qualified = `${label} (${pluginLabel})`
  if (!labels.has(qualified)) return qualified
  let suffix = 2
  while (labels.has(`${qualified} ${suffix}`)) suffix += 1
  return `${qualified} ${suffix}`
}

export function discoverSourceProviderOptions(
  sourceType: NewKnowledgeSourceType,
  datasourcePlugins: DataSourceItem[],
): SourceProviderOption[] {
  const definitions = recommendedProviders.filter(
    (definition) => definition.sourceType === sourceType,
  )
  const recommended: SourceProviderOption[] = definitions.map((definition) => {
    const installed = installedRecommendedProvider(definition, datasourcePlugins)
    return (
      installed ?? {
        fallbackIcon: definition.fallbackIcon,
        installed: false as const,
        key: `${sourceType}:marketplace:${definition.packageId}`,
        label: definition.label,
        packageId: definition.packageId,
        providerType: definition.providerType,
        sourceType,
      }
    )
  })
  const consumedKeys = new Set(
    recommended.flatMap((option) => (option.installed ? [option.key] : [])),
  )
  const labels = new Set(recommended.map((option) => option.label))
  const discovered: InstalledSourceProviderOption[] = []

  for (const plugin of datasourcePlugins) {
    const discoveredSourceType = sourceTypeForProviderType(plugin.declaration.provider_type)
    if (discoveredSourceType !== sourceType) continue
    for (const datasource of plugin.declaration.datasources) {
      const key = providerKey(sourceType, plugin, datasource)
      if (consumedKeys.has(key)) continue
      const rawLabel =
        datasource.identity.label.en_US ||
        plugin.declaration.identity.label.en_US ||
        datasource.identity.name
      const label = uniqueLabel(rawLabel, plugin.declaration.identity.label.en_US, labels)
      labels.add(label)
      discovered.push({
        datasource,
        fallbackIcon: fallbackIcon(sourceType),
        installed: true,
        key,
        label,
        packageId: plugin.plugin_id,
        plugin,
        providerType: plugin.declaration.provider_type,
        sourceType,
      })
    }
  }

  return [...recommended, ...discovered]
}

export function sourceProviderOptionForDraft(
  options: SourceProviderOption[],
  draft: Pick<NewKnowledgeSourceDraft, 'provider' | 'providerKey'>,
) {
  return (
    options.find((option) => option.key === draft.providerKey) ??
    options.find(
      (option) =>
        normalizeSourceProviderName(option.label) === normalizeSourceProviderName(draft.provider),
    ) ??
    options[0]
  )
}
