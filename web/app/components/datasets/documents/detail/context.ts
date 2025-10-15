import type { ChunkingMode, ParentMode } from '@/models/datasets'
import { createContext, useContextSelector } from 'use-context-selector'

type DocumentContextValue = {
  datasetId?: string
  documentId?: string
  docForm?: ChunkingMode
  parentMode?: ParentMode
}

export const DocumentContext = createContext<DocumentContextValue>({})

export const useDocumentContext = (selector: (value: DocumentContextValue) => any) => {
  return useContextSelector(DocumentContext, selector)
}
