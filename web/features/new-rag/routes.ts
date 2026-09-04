import type {
  NewKnowledgeSourceProvider,
  NewKnowledgeSourceType,
} from './sources/setup/source-draft'

export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'

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

export const newKnowledgeQualityBadCasesPath = (knowledgeSpaceId: string) =>
  `${newKnowledgeQualityPath(knowledgeSpaceId)}?tab=bad-cases`

export const newKnowledgeSettingsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/settings`

export type KnowledgeModelCapability =
  | 'deep'
  | 'index'
  | 'ingest'
  | 'query'
  | 'research'
  | 'source_sync'

export function newKnowledgeSettingsReturnPath(
  knowledgeSpaceId: string,
  { capability, returnTo }: { capability?: KnowledgeModelCapability; returnTo?: string } = {},
) {
  const path = newKnowledgeSettingsPath(knowledgeSpaceId)
  const safeReturnTo = validateNewKnowledgeReturnTo(knowledgeSpaceId, returnTo)
  if (!safeReturnTo) return path
  const searchParams = new URLSearchParams({ returnTo: safeReturnTo })
  if (capability) searchParams.set('capability', capability)
  return `${path}?${searchParams.toString()}`
}

export function validateNewKnowledgeReturnTo(
  knowledgeSpaceId: string,
  returnTo: string | null | undefined,
) {
  if (!returnTo || returnTo.startsWith('//') || returnTo.includes('\\')) return undefined
  const expectedPrefix = `/datasets/new/${knowledgeSpaceId}`
  if (returnTo !== expectedPrefix && !returnTo.startsWith(`${expectedPrefix}/`)) return undefined
  return returnTo
}

export function parseKnowledgeModelCapability(
  value: string | null | undefined,
): KnowledgeModelCapability | undefined {
  return value === 'deep' ||
    value === 'index' ||
    value === 'ingest' ||
    value === 'query' ||
    value === 'research' ||
    value === 'source_sync'
    ? value
    : undefined
}

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
