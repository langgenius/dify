import type { ScopeSearchHandler } from './scope-registry'
import type { SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { scopeRegistry } from './scope-registry'

const scopeId = 'workflow-node'
let scopeRegistered = false

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

export const registerWorkflowNodeScope = () => {
  if (scopeRegistered)
    return

  scopeRegistered = true
  scopeRegistry.register({
    id: scopeId,
    shortcut: ACTION_KEYS.NODE,
    title: 'Search Workflow Nodes',
    description: 'Find and jump to nodes in the current workflow by name or type',
    isAvailable: context => context.isWorkflowPage,
    search: buildSearchHandler(),
  })
}

export const setWorkflowNodesSearchFn = (fn: (searchTerm: string) => SearchResult[]) => {
  registerWorkflowNodeScope()
  scopeRegistry.updateSearchHandler(scopeId, buildSearchHandler(fn))
}
