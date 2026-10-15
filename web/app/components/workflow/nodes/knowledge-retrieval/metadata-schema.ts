import type { MetadataFilteringCondition } from './types'
import type { DataSet, MetadataInDoc } from '@/models/datasets'
import { getOperators } from './components/metadata/condition-list/utils'

// Missing schemas participate as empty sets. IDs belong to one dataset; retrieval
// uses field names, so different IDs must not invalidate a shared field.
export const getSharedMetadata = (datasets: Pick<DataSet, 'doc_metadata'>[]): MetadataInDoc[] => {
  const first = datasets[0]?.doc_metadata ?? []
  return first.filter((field) =>
    datasets.every((dataset) =>
      (dataset.doc_metadata ?? []).some(
        (candidate) => candidate.name === field.name && candidate.type === field.type,
      ),
    ),
  )
}

export const getMetadataConflicts = (datasets: Pick<DataSet, 'doc_metadata'>[]): string[] => {
  const sharedNames = new Set(getSharedMetadata(datasets).map((field) => field.name))
  return [
    ...new Set(
      datasets.flatMap((dataset) => (dataset.doc_metadata ?? []).map((field) => field.name)),
    ),
  ].filter((name) => !sharedNames.has(name))
}

export const isMetadataConditionCompatible = (
  condition: MetadataFilteringCondition,
  fields: MetadataInDoc[],
) => {
  const field = fields.find((candidate) => candidate.name === condition.name)
  return (
    !!field &&
    (!condition.type || field.type === condition.type) &&
    getOperators(field.type).some((operator) => operator === condition.comparison_operator)
  )
}
