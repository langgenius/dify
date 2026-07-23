export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'
export type NewKnowledgeSourceType = 'onlineDocuments' | 'onlineDrive' | 'websiteCrawl'
export type NewKnowledgeSyncPolicy = 'daily' | 'manual' | 'provider'
export type NewKnowledgeWebsiteProvider = 'Firecrawl' | 'Jina Reader' | 'WaterCrawl'
export type NewKnowledgeOnlineDocumentsProvider = 'Confluence' | 'Google Docs' | 'Notion'
export type NewKnowledgeOnlineDriveProvider = 'Amazon S3' | 'Google Drive' | 'OneDrive'

type NewKnowledgeSourceDraftBase = {
  sourceName: string
  syncPolicy: NewKnowledgeSyncPolicy
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
const NEW_KNOWLEDGE_SOURCE_DRAFT_STORAGE_PREFIX = 'new-knowledge-source-draft:'

export function createNewKnowledgeSourceDraft(
  sourceType: NewKnowledgeSourceType,
): NewKnowledgeSourceDraft {
  if (sourceType === 'onlineDocuments')
    return {
      provider: 'Notion',
      sourceName: '',
      sourceType,
      syncPolicy: 'provider',
    }
  if (sourceType === 'onlineDrive')
    return {
      provider: 'Google Drive',
      sourceName: '',
      sourceType,
      syncPolicy: 'provider',
    }
  return {
    includeSubpages: true,
    maxPages: 100,
    provider: 'Firecrawl',
    rootUrl: '',
    sourceName: '',
    sourceType,
    syncPolicy: 'provider',
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
    const syncPolicy = ['daily', 'manual', 'provider'].includes(String(candidate.syncPolicy))
      ? (candidate.syncPolicy as NewKnowledgeSyncPolicy)
      : candidate.syncPolicy === undefined
        ? 'provider'
        : undefined
    if (
      typeof candidate.sourceName !== 'string' ||
      candidate.sourceName.length > NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH ||
      !syncPolicy
    )
      return undefined
    if (candidate.sourceType === 'onlineDocuments') {
      if (!['Confluence', 'Google Docs', 'Notion'].includes(String(candidate.provider)))
        return undefined
      return {
        provider: candidate.provider as NewKnowledgeOnlineDocumentsProvider,
        sourceName: candidate.sourceName,
        sourceType: candidate.sourceType,
        syncPolicy,
      }
    }
    if (candidate.sourceType === 'onlineDrive') {
      if (!['Amazon S3', 'Google Drive', 'OneDrive'].includes(String(candidate.provider)))
        return undefined
      return {
        provider: candidate.provider as NewKnowledgeOnlineDriveProvider,
        sourceName: candidate.sourceName,
        sourceType: candidate.sourceType,
        syncPolicy,
      }
    }
    if (
      (candidate.sourceType !== undefined && candidate.sourceType !== 'websiteCrawl') ||
      !['Firecrawl', 'Jina Reader', 'WaterCrawl'].includes(String(candidate.provider)) ||
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
      includeSubpages: candidate.includeSubpages,
      maxPages: candidate.maxPages,
      provider: candidate.provider as NewKnowledgeWebsiteProvider,
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

export const newKnowledgeCreatePath = '/datasets/new/create'

export const newKnowledgeListPath = '/datasets?view=new'

export const newKnowledgeCreatePathWithStartMode = (startMode: NewKnowledgeStartMode) =>
  `${newKnowledgeCreatePath}?start=${startMode}`

export const newKnowledgeDetailPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources`

export const newKnowledgeDocumentsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents`

export const newKnowledgeDocumentDetailPath = (knowledgeSpaceId: string, documentId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents/${documentId}`

export const newKnowledgeAddSourcePath = (
  knowledgeSpaceId: string,
  sourceType?: NewKnowledgeSourceType,
  draftKey?: string,
) => {
  const searchParams = new URLSearchParams()
  if (sourceType) searchParams.set('type', sourceType)
  if (draftKey) searchParams.set('draft', draftKey)
  const query = searchParams.toString()
  return `/datasets/new/${knowledgeSpaceId}/sources/new${query ? `?${query}` : ''}`
}
