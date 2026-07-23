export type NewKnowledgeStartMode = 'empty' | 'source' | 'upload'

const newKnowledgeCreatePath = '/datasets/new/create'

export const newKnowledgeListPath = '/datasets?view=new'

export const newKnowledgeCreatePathWithStartMode = (startMode: NewKnowledgeStartMode) =>
  `${newKnowledgeCreatePath}?start=${startMode}`

export const newKnowledgeDetailPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources`

export const newKnowledgeDocumentsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents`
