export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'
export type NewKnowledgeSourceType = 'onlineDocuments' | 'onlineDrive' | 'websiteCrawl'
export type NewKnowledgeSourceDraft = {
  includeSubpages: boolean
  maxPages: number
  provider: string
  rootUrl: string
  sourceName: string
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
  draft?: NewKnowledgeSourceDraft,
) => {
  const searchParams = new URLSearchParams()
  if (sourceType) searchParams.set('type', sourceType)
  if (draft?.provider && draft.provider !== 'Firecrawl')
    searchParams.set('provider', draft.provider)
  if (draft?.rootUrl.trim()) searchParams.set('rootUrl', draft.rootUrl.trim())
  if (draft?.sourceName.trim()) searchParams.set('sourceName', draft.sourceName.trim())
  if (draft && !draft.includeSubpages) searchParams.set('includeSubpages', 'false')
  if (draft && draft.maxPages !== 100) searchParams.set('maxPages', String(draft.maxPages))
  const query = searchParams.toString()
  return `/datasets/new/${knowledgeSpaceId}/sources/new${query ? `?${query}` : ''}`
}
