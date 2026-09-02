import type { MetadataInDoc } from '@/models/datasets'
import type { KnowledgeFsMetadataField } from '@/service/knowledge-fs/metadata'
import {
  MetadataFilteringModeEnum,
  MetadataFilteringVariableType,
} from '@/app/components/workflow/nodes/knowledge-retrieval/types'

export const KNOWLEDGE_FS_METADATA_FILTER_MODES = [
  MetadataFilteringModeEnum.disabled,
  MetadataFilteringModeEnum.automatic,
  MetadataFilteringModeEnum.manual,
] as const

export const normalizeKnowledgeFsMetadataFilterMode = (
  mode: MetadataFilteringModeEnum | undefined,
): MetadataFilteringModeEnum =>
  mode && KNOWLEDGE_FS_METADATA_FILTER_MODES.includes(mode)
    ? mode
    : MetadataFilteringModeEnum.disabled

const metadataVariableType = (
  type: KnowledgeFsMetadataField['type'],
): MetadataFilteringVariableType => {
  if (type === 'number') return MetadataFilteringVariableType.number
  if (type === 'time') return MetadataFilteringVariableType.time
  return MetadataFilteringVariableType.string
}

export const intersectKnowledgeFsMetadataFields = (
  fieldGroups: readonly (readonly KnowledgeFsMetadataField[])[],
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
