import type { ScopeSearchHandler } from './scope-registry'
import type { SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { scopeRegistry } from './scope-registry'

const scopeId = 'rag-pipeline-node'
let scopeRegistered = false

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

export const registerRagPipelineNodeScope = () => {
  if (scopeRegistered)
    return

  scopeRegistered = true
  scopeRegistry.register({
    id: scopeId,
    shortcut: ACTION_KEYS.NODE,
    title: 'Search RAG Pipeline Nodes',
    description: 'Find and jump to nodes in the current RAG pipeline by name or type',
    isAvailable: context => context.isRagPipelinePage,
    search: buildSearchHandler(),
  })
}

export const setRagPipelineNodesSearchFn = (fn: (searchTerm: string) => SearchResult[]) => {
  registerRagPipelineNodeScope()
  scopeRegistry.updateSearchHandler(scopeId, buildSearchHandler(fn))
}
