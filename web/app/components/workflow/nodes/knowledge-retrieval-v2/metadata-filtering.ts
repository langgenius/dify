import type { KnowledgeRetrievalV2NodeType } from './types'
import type { MetadataFilteringCondition } from '@/app/components/workflow/nodes/knowledge-retrieval/types'
import type { ValueSelector } from '@/app/components/workflow/types'
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

const metadataVariableType = (type: KnowledgeFsMetadataField['type']): MetadataInDoc['type'] => {
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
    }))
}

type MetadataConditionValue = MetadataFilteringCondition['value']

const metadataConditionValueTexts = (value: MetadataConditionValue): string[] => {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string')
  return []
}

// Manual metadata conditions resolve `{{#node.var#}}` templates at run time, so their values are
// variable references the workflow must track like the query selectors.
export const getKnowledgeRetrievalV2MetadataValueTexts = (
  payload: Pick<KnowledgeRetrievalV2NodeType, 'metadata_filtering_conditions'>,
): string[] =>
  (payload.metadata_filtering_conditions?.conditions ?? []).flatMap((condition) =>
    metadataConditionValueTexts(condition.value),
  )

const replaceVarInMetadataText = (
  text: string,
  oldVarSelector: ValueSelector,
  newVarSelector: ValueSelector,
) =>
  text.replaceAll(
    `{{#${oldVarSelector.join('.')}#}}`,
    newVarSelector.length > 0 ? `{{#${newVarSelector.join('.')}#}}` : '',
  )

// An empty new selector means the variable was removed: drop the reference so the condition is no
// longer bound to a missing variable instead of keeping a dangling template.
export const replaceKnowledgeRetrievalV2MetadataVar = (
  payload: Pick<KnowledgeRetrievalV2NodeType, 'metadata_filtering_conditions'>,
  oldVarSelector: ValueSelector,
  newVarSelector: ValueSelector,
) => {
  payload.metadata_filtering_conditions?.conditions.forEach((condition) => {
    const { value } = condition
    if (typeof value === 'string') {
      const nextValue = replaceVarInMetadataText(value, oldVarSelector, newVarSelector)
      condition.value = nextValue || undefined
    } else if (Array.isArray(value)) {
      condition.value = value
        .map((item) => replaceVarInMetadataText(item, oldVarSelector, newVarSelector))
        .filter(Boolean)
    }
  })
}
