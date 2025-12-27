import type { ScopeSearchHandler } from './scope-registry'
import type { SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { scopeRegistry } from './scope-registry'

const scopeId = 'workflow-node'

const buildSearchHandler = (searchFn?: (searchTerm: string) => SearchResult[]): ScopeSearchHandler => {
  return async (_, searchTerm = '', _locale) => {
    try {
      if (searchFn)
        return searchFn(searchTerm)
      return []
    }
    catch (error) {
      console.warn('Workflow nodes search failed:', error)
      return []
    }
  }
}

export const setWorkflowNodesSearchFn = (fn: (searchTerm: string) => SearchResult[]) => {
  scopeRegistry.updateSearchHandler(scopeId, buildSearchHandler(fn))
}

// Register the workflow nodes action
scopeRegistry.register({
  id: scopeId,
  shortcut: ACTION_KEYS.NODE,
  title: 'Search Workflow Nodes',
  description: 'Find and jump to nodes in the current workflow by name or type',
  isAvailable: context => context.isWorkflowPage,
  search: buildSearchHandler(),
})

// Legacy export if needed (though we should migrate away from it)
export const workflowNodesAction = {
  key: ACTION_KEYS.NODE,
  search: async () => [], // Dummy implementation
}
