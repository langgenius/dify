import type { ActionItem } from './types'
import { ACTION_KEYS } from '../constants'

// Create the RAG pipeline nodes action
export const ragPipelineNodesAction: ActionItem = {
  key: ACTION_KEYS.NODE,
  shortcut: ACTION_KEYS.NODE,
  title: 'Search RAG Pipeline Nodes',
  description: 'Find and jump to nodes in the current RAG pipeline by name or type',
  searchFn: undefined, // Will be set by useRagPipelineSearch hook
  search: async (_, searchTerm = '', _locale) => {
    try {
      // Use the searchFn if available (set by useRagPipelineSearch hook)
      if (ragPipelineNodesAction.searchFn)
        return ragPipelineNodesAction.searchFn(searchTerm)

      // If not in RAG pipeline context, return empty array
      return []
    }
    catch (error) {
      console.warn('RAG pipeline nodes search failed:', error)
      return []
    }
  },
}
