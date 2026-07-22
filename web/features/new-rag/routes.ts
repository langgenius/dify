export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'

export const newKnowledgeCreatePath = '/datasets/new/create'

export const newKnowledgeCreatePathWithStartMode = (startMode: NewKnowledgeStartMode) =>
  `${newKnowledgeCreatePath}?start=${startMode}`

export const newKnowledgeDetailPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources`

export const newKnowledgeDocumentsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents`

export const newKnowledgeAddSourcePath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources/new`
