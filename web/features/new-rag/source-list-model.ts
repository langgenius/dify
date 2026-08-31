import type { KnowledgeFsSourceUpdatePayload } from '@dify/contracts/api/console/knowledge-fs/types.gen'
import type { Source, SourceSyncPolicy } from './source-models'
import { normalizeSourceProviderName, sourceProviderPresentation } from './source-provider-options'

const MIN_CUSTOM_INTERVAL_HOURS = 1

export function metadataString(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function metadataRecord(metadata: Source['metadata'], key: string) {
  const value = metadata[key]
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function sourceProviderType(source: Source, providerKind?: string) {
  if (source.type === 'web' || providerKind === 'website') return 'websiteCrawl' as const
  if (providerKind === 'online-document') return 'onlineDocuments' as const
  if (providerKind === 'online-drive') return 'onlineDrive' as const
  return undefined
}

export function sourceProviderDetails(source: Source) {
  const providerKind = metadataString(source.metadata, 'providerKind')
  const providerType = sourceProviderType(source, providerKind)
  const explicitName = metadataString(source.metadata, 'providerName')
  if (explicitName) {
    const presentation = sourceProviderPresentation(explicitName, providerType)
    return {
      iconClass: presentation?.fallbackIcon,
      name: presentation?.label ?? explicitName,
    }
  }

  const providerId = metadataString(source.metadata, 'providerId')
  if (!providerId) return {}
  const presentation = sourceProviderPresentation(providerId, providerType)
  if (presentation) return { iconClass: presentation.fallbackIcon, name: presentation.label }
  if (normalizeSourceProviderName(providerId).includes('fakecrawler'))
    return { name: 'FakeCrawler' }
  return {}
}

export function sourceLastSyncAt(source: Source) {
  const syncMetadata = metadataRecord(source.metadata, 'sync')
  return (
    source.lastSyncedAt ??
    metadataString(source.metadata, 'lastSyncedAt') ??
    (syncMetadata ? metadataString(syncMetadata, 'lastRunAt') : undefined)
  )
}

export function sourceSyncPolicyTranslationKey(policy: SourceSyncPolicy) {
  if (!policy.enabled || policy.mode === 'manual') return 'newKnowledge.syncPolicyManual' as const
  if (policy.mode === 'interval') return 'newKnowledge.syncPolicyDaily' as const
  return 'newKnowledge.syncPolicyCustom' as const
}

export function sourceSyncMode(source: Source): SourceSyncPolicy['mode'] {
  return source.syncPolicy?.mode ?? 'manual'
}

export function sourceCustomIntervalHours(source: Source) {
  return source.syncPolicy?.customIntervalSeconds
    ? source.syncPolicy.customIntervalSeconds / 3600
    : MIN_CUSTOM_INTERVAL_HOURS
}

export function syncPolicyConfiguration(
  mode: SourceSyncPolicy['mode'],
  customIntervalHours: number,
) {
  if (mode === 'manual') return { enabled: false, mode } as const
  if (mode === 'custom')
    return {
      customIntervalSeconds: customIntervalHours * 3600,
      enabled: true,
      mode,
    } as const
  return { enabled: true, mode } as const
}

export type SourceEditValues = Omit<KnowledgeFsSourceUpdatePayload, 'status' | 'syncAfterUpdate'>

export function createIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`
}

export function getOpenableSourceUri(uri: string) {
  try {
    const url = new URL(uri)
    if (url.protocol === 's3:' && url.hostname) {
      const prefix = decodeURIComponent(url.pathname.replace(/^\//, ''))
      const consoleUrl = new URL(`https://s3.console.aws.amazon.com/s3/buckets/${url.hostname}`)
      if (prefix) consoleUrl.searchParams.set('prefix', prefix)
      return consoleUrl.toString()
    }
    return url.protocol === 'http:' || url.protocol === 'https:' ? uri : undefined
  } catch {
    return undefined
  }
}

export type SourceAction = 'edit' | 'remove' | 'sync' | 'toggle'
