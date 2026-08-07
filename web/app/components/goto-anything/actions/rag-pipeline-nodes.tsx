import type { ActionItem } from './types'
import { findRagPipelineNodes } from '@/app/components/rag-pipeline/goto-anything-search'

export const ragPipelineNodesAction: ActionItem = {
  key: '@node',
  shortcut: '@node',
  title: 'Search RAG Pipeline Nodes',
  description: 'Find and jump to nodes in the current RAG pipeline by name or type',
  source: 'local',
  search: (_, searchTerm = '', _locale) => {
    try {
      return findRagPipelineNodes(searchTerm)
    } catch (error) {
      console.warn('RAG pipeline nodes search failed:', error)
      return []
    }
  },
}
