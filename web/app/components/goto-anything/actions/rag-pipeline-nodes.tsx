import type { ScopeSearchHandler } from './scope-registry'
import type { SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { scopeRegistry } from './scope-registry'

const scopeId = 'rag-pipeline-node'

const buildSearchHandler = (searchFn?: (searchTerm: string) => SearchResult[]): ScopeSearchHandler => {
  return async (_, searchTerm = '', _locale) => {
    try {
      if (searchFn)
        return searchFn(searchTerm)
      return []
    }
    catch (error) {
      console.warn('RAG pipeline nodes search failed:', error)
      return []
    }
  }
}

export const setRagPipelineNodesSearchFn = (fn: (searchTerm: string) => SearchResult[]) => {
  scopeRegistry.updateSearchHandler(scopeId, buildSearchHandler(fn))
}

// Register the RAG pipeline nodes action
scopeRegistry.register({
  id: scopeId,
  shortcut: ACTION_KEYS.NODE,
  title: 'Search RAG Pipeline Nodes',
  description: 'Find and jump to nodes in the current RAG pipeline by name or type',
  isAvailable: context => context.isRagPipelinePage,
  search: buildSearchHandler(),
})

// Legacy export
export const ragPipelineNodesAction = {
  key: ACTION_KEYS.NODE,
  search: async () => [],
}
