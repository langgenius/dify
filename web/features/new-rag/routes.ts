export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'
export type NewKnowledgeSourceType = 'onlineDocuments' | 'onlineDrive' | 'websiteCrawl'
export type NewKnowledgeSourceDraft = {
  includeSubpages: boolean
  maxPages: number
  provider: string
  rootUrl: string
  sourceName: string
}

export const NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH = 200
export const NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH = 2048
const NEW_KNOWLEDGE_SOURCE_DRAFT_STORAGE_PREFIX = 'new-knowledge-source-draft:'

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
  draft: NewKnowledgeSourceDraft,
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
    if (
      typeof candidate.includeSubpages !== 'boolean' ||
      typeof candidate.maxPages !== 'number' ||
      !Number.isInteger(candidate.maxPages) ||
      candidate.maxPages < 1 ||
      candidate.maxPages > 200 ||
      typeof candidate.provider !== 'string' ||
      candidate.provider.length > 100 ||
      typeof candidate.rootUrl !== 'string' ||
      candidate.rootUrl.length > NEW_KNOWLEDGE_SOURCE_URL_MAX_LENGTH ||
      typeof candidate.sourceName !== 'string' ||
      candidate.sourceName.length > NEW_KNOWLEDGE_SOURCE_NAME_MAX_LENGTH
    )
      return undefined
    return candidate as NewKnowledgeSourceDraft
  } catch {
    return undefined
  }
}

export function singleSearchParam(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined
}

export const newKnowledgeCreatePath = '/datasets/new/create'

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
