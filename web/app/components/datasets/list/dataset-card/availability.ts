import type { DataSet } from '@/models/datasets'

export const isDatasetAvailable = (
  dataset: Pick<DataSet, 'embedding_available' | 'reranking_available'>,
) => dataset.embedding_available && dataset.reranking_available !== false
