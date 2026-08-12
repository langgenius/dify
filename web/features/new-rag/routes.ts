import type { DatasourceParameters } from './datasource-parameter-model'
import { datasourceParameterRecord } from './datasource-parameter-model'

export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'
export type NewKnowledgeSourceType = 'onlineDocuments' | 'onlineDrive' | 'websiteCrawl'
type NewKnowledgeSyncPolicy = 'custom' | 'daily' | 'manual' | 'provider'
export type NewKnowledgeWebsiteProvider = string
export type NewKnowledgeOnlineDocumentsProvider = string
export type NewKnowledgeOnlineDriveProvider = string
export type NewKnowledgeSourceProvider =
  | NewKnowledgeOnlineDocumentsProvider
  | NewKnowledgeOnlineDriveProvider
  | NewKnowledgeWebsiteProvider

type NewKnowledgeSourceDraftBase = {
  customIntervalSeconds?: number
  parameters?: DatasourceParameters
  sourceName: string
  syncPolicy: NewKnowledgeSyncPolicy
  providerKey?: string
}

export type NewKnowledgeWebsiteSourceDraft = NewKnowledgeSourceDraftBase & {
  includeSubpages: boolean
  maxPages: number
  provider: NewKnowledgeWebsiteProvider
  rootUrl: string
  sourceType: 'websiteCrawl'
}

export type NewKnowledgeOnlineDocumentsSourceDraft = NewKnowledgeSourceDraftBase & {
  provider: NewKnowledgeOnlineDocumentsProvider
  sourceType: 'onlineDocuments'
}

export type NewKnowledgeOnlineDriveSourceDraft = NewKnowledgeSourceDraftBase & {
  provider: NewKnowledgeOnlineDriveProvider
  sourceType: 'onlineDrive'
}

export type NewKnowledgeSourceDraft =
  | NewKnowledgeOnlineDocumentsSourceDraft
  | NewKnowledgeOnlineDriveSourceDraft
  | NewKnowledgeWebsiteSourceDraft

export const NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH = 200
export const NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH = 2048
const NEW_KNOWLEDGE_PROVIDER_NAME_MAX_LENGTH = 200
const NEW_KNOWLEDGE_PROVIDER_KEY_MAX_LENGTH = 1024
const NEW_KNOWLEDGE_SOURCE_DRAFT_STORAGE_PREFIX = 'new-knowledge-source-draft:'
const MIN_CUSTOM_SYNC_INTERVAL_SECONDS = 3_600
const MAX_CUSTOM_SYNC_INTERVAL_SECONDS = 2_592_000

export function createNewKnowledgeSourceDraft(
  sourceType: NewKnowledgeSourceType,
  initialProvider?: string,
): NewKnowledgeSourceDraft {
  if (sourceType === 'onlineDocuments')
    return {
      provider: initialProvider?.trim() || 'Notion',
      parameters: {},
      sourceName: '',
      sourceType,
      syncPolicy: 'provider',
    }
  if (sourceType === 'onlineDrive')
    return {
      provider: initialProvider?.trim() || 'Google Drive',
      parameters: {},
      sourceName: '',
      sourceType,
      syncPolicy: 'provider',
    }
  return {
    includeSubpages: true,
    maxPages: 100,
    parameters: {},
    provider: initialProvider?.trim() || 'Firecrawl',
    rootUrl: '',
    sourceName: '',
    sourceType,
    syncPolicy: 'daily',
  }
}

export function normalizeWebsiteSourceUrl(value: string) {
  if (value.length > NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH) return undefined
  try {
    const url = new URL(value.trim())
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      return undefined
    url.hash = ''
    return url
  } catch {
    return undefined
  }
}

export function isValidWebsiteSourceDraft(
  draft: NewKnowledgeWebsiteSourceDraft,
  { allowEmpty = false }: { allowEmpty?: boolean } = {},
) {
  const hasInput = Boolean(
    draft.rootUrl.length ||
    draft.sourceName.length ||
    !draft.includeSubpages ||
    draft.maxPages !== 100,
  )
  if (allowEmpty && !hasInput) return true
  const sourceName = draft.sourceName.trim()
  return Boolean(
    normalizeWebsiteSourceUrl(draft.rootUrl) &&
    sourceName &&
    sourceName.length <= NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH &&
    Number.isInteger(draft.maxPages) &&
    draft.maxPages > 0 &&
    draft.maxPages <= 200,
  )
}

export function newKnowledgeSourceDraftStorageKey(draftKey: string) {
  return `${NEW_KNOWLEDGE_SOURCE_DRAFT_STORAGE_PREFIX}${draftKey}`
}

export function parseNewKnowledgeSourceDraft(value: string): NewKnowledgeSourceDraft | undefined {
  try {
    const draft: unknown = JSON.parse(value)
    if (!draft || typeof draft !== 'object') return undefined
    const candidate = draft as Record<string, unknown>
    const syncPolicy = ['custom', 'daily', 'manual', 'provider'].includes(
      String(candidate.syncPolicy),
    )
      ? (candidate.syncPolicy as NewKnowledgeSyncPolicy)
      : candidate.syncPolicy === undefined
        ? 'provider'
        : undefined
    const customIntervalSeconds =
      typeof candidate.customIntervalSeconds === 'number' &&
      Number.isInteger(candidate.customIntervalSeconds) &&
      candidate.customIntervalSeconds >= MIN_CUSTOM_SYNC_INTERVAL_SECONDS &&
      candidate.customIntervalSeconds <= MAX_CUSTOM_SYNC_INTERVAL_SECONDS
        ? candidate.customIntervalSeconds
        : undefined
    const parameters =
      candidate.parameters === undefined ? {} : datasourceParameterRecord(candidate.parameters)
    if (
      typeof candidate.sourceName !== 'string' ||
      candidate.sourceName.length > NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH ||
      typeof candidate.provider !== 'string' ||
      !candidate.provider.trim() ||
      candidate.provider.length > NEW_KNOWLEDGE_PROVIDER_NAME_MAX_LENGTH ||
      (candidate.providerKey !== undefined &&
        (typeof candidate.providerKey !== 'string' ||
          !candidate.providerKey ||
          candidate.providerKey.length > NEW_KNOWLEDGE_PROVIDER_KEY_MAX_LENGTH)) ||
      !syncPolicy ||
      (syncPolicy === 'custom' && !customIntervalSeconds) ||
      !parameters
    )
      return undefined
    if (candidate.sourceType === 'onlineDocuments') {
      return {
        ...(syncPolicy === 'custom' ? { customIntervalSeconds } : {}),
        provider: candidate.provider,
        parameters,
        ...(candidate.providerKey ? { providerKey: candidate.providerKey } : {}),
        sourceName: candidate.sourceName,
        sourceType: candidate.sourceType,
        syncPolicy,
      }
    }
    if (candidate.sourceType === 'onlineDrive') {
      return {
        ...(syncPolicy === 'custom' ? { customIntervalSeconds } : {}),
        provider: candidate.provider,
        parameters,
        ...(candidate.providerKey ? { providerKey: candidate.providerKey } : {}),
        sourceName: candidate.sourceName,
        sourceType: candidate.sourceType,
        syncPolicy,
      }
    }
    if (
      (candidate.sourceType !== undefined && candidate.sourceType !== 'websiteCrawl') ||
      typeof candidate.includeSubpages !== 'boolean' ||
      typeof candidate.maxPages !== 'number' ||
      !Number.isInteger(candidate.maxPages) ||
      candidate.maxPages < 1 ||
      candidate.maxPages > 200 ||
      typeof candidate.rootUrl !== 'string' ||
      candidate.rootUrl.length > NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH
    )
      return undefined
    return {
      ...(syncPolicy === 'custom' ? { customIntervalSeconds } : {}),
      includeSubpages: candidate.includeSubpages,
      maxPages: candidate.maxPages,
      parameters,
      provider: candidate.provider,
      ...(candidate.providerKey ? { providerKey: candidate.providerKey } : {}),
      rootUrl: candidate.rootUrl,
      sourceName: candidate.sourceName,
      sourceType: 'websiteCrawl',
      syncPolicy,
    }
  } catch {
    return undefined
  }
}

export function singleSearchParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined
}

const newKnowledgeCreatePath = '/datasets/new/create'

export const newKnowledgeListPath = '/datasets?view=new'

export const newKnowledgeOverviewPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}`

export const newKnowledgeCreatePathWithStartMode = (startMode: NewKnowledgeStartMode) =>
  `${newKnowledgeCreatePath}?start=${startMode}`

export const newKnowledgeDetailPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources`

export const newKnowledgeDocumentsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents`

export const newKnowledgeRetrievalTestPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/retrieval`

export const newKnowledgeQualityPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/quality`

export const newKnowledgeSettingsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/settings`

export const newKnowledgeDocumentDetailPath = (
  knowledgeSpaceId: string,
  documentId: string,
  { chunkId, revision }: { chunkId?: string; revision?: number } = {},
) => {
  const searchParams = new URLSearchParams()
  if (revision !== undefined) searchParams.set('revision', String(revision))
  if (chunkId) searchParams.set('chunk', chunkId)
  const query = searchParams.toString()
  return `/datasets/new/${knowledgeSpaceId}/documents/${documentId}${query ? `?${query}` : ''}`
}

type NewKnowledgeAddSourcePathOptions = {
  draftKey?: string
  provider?: NewKnowledgeSourceProvider
  sourceType?: NewKnowledgeSourceType
}

export const newKnowledgeAddSourcePath = (
  knowledgeSpaceId: string,
  { draftKey, provider, sourceType }: NewKnowledgeAddSourcePathOptions = {},
) => {
  const searchParams = new URLSearchParams()
  if (sourceType) searchParams.set('type', sourceType)
  if (provider) searchParams.set('provider', provider)
  if (draftKey) searchParams.set('draft', draftKey)
  const query = searchParams.toString()
  return `/datasets/new/${knowledgeSpaceId}/sources/new${query ? `?${query}` : ''}`
}
