'use client'

import { createLocalStorageState } from 'foxact/create-local-storage-state'

const NEW_KNOWLEDGE_GUIDE_DISMISSED_STORAGE_KEY = 'dify-new-knowledge-guide-dismissed'

const [
  _useNewKnowledgeGuideDismissed,
  useNewKnowledgeGuideDismissedValue,
  useSetNewKnowledgeGuideDismissed,
] = createLocalStorageState<boolean>(NEW_KNOWLEDGE_GUIDE_DISMISSED_STORAGE_KEY, false)

export { useNewKnowledgeGuideDismissedValue, useSetNewKnowledgeGuideDismissed }
