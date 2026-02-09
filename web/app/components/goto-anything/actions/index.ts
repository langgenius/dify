/**
 * Goto Anything - Action System
 *
 * This file defines the action registry for the goto-anything search system.
 * Actions handle different types of searches: apps, knowledge bases, plugins, workflow nodes, and commands.
 */

import type { ScopeContext, ScopeDescriptor, SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { appScope } from './app'
import { slashScope } from './commands'
import { slashCommandRegistry } from './commands/registry'
import { knowledgeScope } from './knowledge'
import { pluginScope } from './plugin'
import { registerRagPipelineNodeScope } from './rag-pipeline-nodes'
import { scopeRegistry, useScopeRegistry } from './scope-registry'
import { registerWorkflowNodeScope } from './workflow-nodes'

let scopesInitialized = false

export const initGotoAnythingScopes = () => {
  if (scopesInitialized)
    return

  scopesInitialized = true

  scopeRegistry.register(slashScope)
  scopeRegistry.register(appScope)
  scopeRegistry.register(knowledgeScope)
  scopeRegistry.register(pluginScope)
  registerWorkflowNodeScope()
  registerRagPipelineNodeScope()
}

export const useGotoAnythingScopes = (context: ScopeContext) => {
  initGotoAnythingScopes()
  return useScopeRegistry(context)
}

const isSlashScope = (scope: ScopeDescriptor) => {
  if (scope.shortcut === ACTION_KEYS.SLASH)
    return true
  return scope.aliases?.includes(ACTION_KEYS.SLASH) ?? false
}

const getScopeShortcuts = (scope: ScopeDescriptor) => [scope.shortcut, ...(scope.aliases ?? [])]

export const searchAnything = async (
  locale: string,
  query: string,
  scope: ScopeDescriptor | undefined,
  scopes: ScopeDescriptor[],
): Promise<SearchResult[]> => {
  const trimmedQuery = query.trim()

  if (scope) {
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const shortcuts = getScopeShortcuts(scope).map(escapeRegExp)
    const prefixPattern = new RegExp(`^(${shortcuts.join('|')})\\s*`)
    const searchTerm = trimmedQuery.replace(prefixPattern, '').trim()
    try {
      return await scope.search(query, searchTerm, locale)
    }
    catch (error) {
      console.warn(`Search failed for ${scope.id}:`, error)
      return []
    }
  }

  if (trimmedQuery.startsWith('@') || trimmedQuery.startsWith('/'))
    return []

  // Filter out slash commands from general search
  const searchScopes = scopes.filter(scope => !isSlashScope(scope))

  // Use Promise.allSettled to handle partial failures gracefully
  const searchPromises = searchScopes.map(async (action) => {
    const actionId = action.id
    try {
      const results = await action.search(query, query, locale)
      return { success: true, data: results, actionType: actionId }
    }
    catch (error) {
      console.warn(`Search failed for ${actionId}:`, error)
      return { success: false, data: [], actionType: actionId, error }
    }
  })

  const settledResults = await Promise.allSettled(searchPromises)

  const allResults: SearchResult[] = []
  const failedActions: string[] = []

  settledResults.forEach((result, index) => {
    if (result.status === 'fulfilled' && result.value.success) {
      allResults.push(...result.value.data)
    }
    else {
      const actionKey = searchScopes[index]?.id || 'unknown'
      failedActions.push(actionKey)
    }
  })

  if (failedActions.length > 0)
    console.warn(`Some search actions failed: ${failedActions.join(', ')}`)

  return allResults
}

// ...

export const matchAction = (query: string, scopes: ScopeDescriptor[]) => {
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return scopes.find((scope) => {
    // Special handling for slash commands
    if (isSlashScope(scope)) {
      const allCommands = slashCommandRegistry.getAllCommands()
      return allCommands.some((cmd) => {
        const cmdPattern = `/${cmd.name}`
        if (cmd.mode === 'direct')
          return false
        return query === cmdPattern || query.startsWith(`${cmdPattern} `)
      })
    }

    // Check if query matches shortcut (exact or prefix)
    // Only match if it's the full shortcut followed by space
    const shortcuts = getScopeShortcuts(scope).map(escapeRegExp)
    const reg = new RegExp(`^(${shortcuts.join('|')})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './commands'
export * from './scope-registry'
export * from './types'
export { appScope, knowledgeScope, pluginScope }
