'use client'

import { createLocalStorageState } from 'foxact/create-local-storage-state'

export const MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY =
  'dify-knowledge-multimodal-retrieval-embedding-guidance-dismissed'

const [
  _useMultimodalRetrievalGuidanceDismissed,
  useMultimodalRetrievalGuidanceDismissedValue,
  useSetMultimodalRetrievalGuidanceDismissed,
] = createLocalStorageState<boolean>(MULTIMODAL_RETRIEVAL_GUIDANCE_DISMISSED_STORAGE_KEY, false)

export { useMultimodalRetrievalGuidanceDismissedValue, useSetMultimodalRetrievalGuidanceDismissed }
