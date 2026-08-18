import type { DocumentMetadataField } from '@/features/new-rag/document-metadata-model'
import type { MetadataInDoc } from '@/models/datasets'
import { MetadataFilteringVariableType } from '@/app/components/workflow/nodes/knowledge-retrieval/types'

const metadataVariableType = (
  type: DocumentMetadataField['type'],
): MetadataFilteringVariableType => {
  if (type === 'number') return MetadataFilteringVariableType.number
  if (type === 'time') return MetadataFilteringVariableType.time
  return MetadataFilteringVariableType.string
}

export const intersectKnowledgeFsMetadataFields = (
  fieldGroups: readonly (readonly DocumentMetadataField[])[],
): MetadataInDoc[] => {
  const [firstGroup, ...remainingGroups] = fieldGroups
  if (!firstGroup) return []

  const remainingFieldTypes = remainingGroups.map(
    (fields) => new Map(fields.map((field) => [field.name, field.type])),
  )

  return firstGroup
    .filter((field) => remainingFieldTypes.every((fields) => fields.get(field.name) === field.type))
    .map((field) => ({
      id: `knowledge-fs:${field.type}:${field.name}`,
      name: field.name,
      type: metadataVariableType(field.type),
      value: field.name,
    }))
}
