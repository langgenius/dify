import type { ChunkingMode, ParentMode } from '@/models/datasets'
import { createContext, useContextSelector } from 'use-context-selector'

export type DocumentContextValue = {
  datasetId?: string
  documentId?: string
  docForm?: ChunkingMode
  parentMode?: ParentMode
  canEdit?: boolean
}

export const DocumentContext = createContext<DocumentContextValue>({})

export const useDocumentContext = <T>(selector: (value: DocumentContextValue) => T) => {
  return useContextSelector(DocumentContext, selector)
}
