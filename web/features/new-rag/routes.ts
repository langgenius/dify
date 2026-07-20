export const newKnowledgeCreatePath = '/datasets/new/create'

export const newKnowledgeDetailPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources`

export const newKnowledgeDocumentsPath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/documents`

export const newKnowledgeAddSourcePath = (knowledgeSpaceId: string) =>
  `/datasets/new/${knowledgeSpaceId}/sources/new`
