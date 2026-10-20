import type { DatasetDetailResponse } from '@dify/contracts/api/console/datasets/types.gen'

export const isDatasetAvailable = (
  dataset: Pick<DatasetDetailResponse, 'embedding_available' | 'reranking_available'>,
) => !!dataset.embedding_available && dataset.reranking_available !== false
