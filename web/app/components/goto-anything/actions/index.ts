/**
 * Goto Anything - Action System
 *
 * This file defines the action registry for the goto-anything search system.
 * Actions handle different types of searches: apps, knowledge bases, plugins, workflow nodes, and commands.
 */

import type { ActionItem, ScopeDescriptor, SearchResult } from './types'
import { ACTION_KEYS } from '../constants'
import { appAction } from './app'
import { slashAction } from './commands'
import { slashCommandRegistry } from './commands/registry'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { scopeRegistry } from './scope-registry'

let defaultScopesRegistered = false

export const registerDefaultScopes = () => {
  if (defaultScopesRegistered)
    return

  defaultScopesRegistered = true

  scopeRegistry.register({
    id: 'slash',
    shortcut: ACTION_KEYS.SLASH,
    title: 'Commands',
    description: 'Execute commands',
    search: slashAction.search,
    isAvailable: () => true,
  })

  scopeRegistry.register({
    id: 'app',
    shortcut: ACTION_KEYS.APP,
    title: 'Search Applications',
    description: 'Search and navigate to your applications',
    search: appAction.search,
    isAvailable: () => true,
  })

  scopeRegistry.register({
    id: 'knowledge',
    shortcut: ACTION_KEYS.KNOWLEDGE,
    title: 'Search Knowledge Bases',
    description: 'Search and navigate to your knowledge bases',
    search: knowledgeAction.search,
    isAvailable: () => true,
  })

  scopeRegistry.register({
    id: 'plugin',
    shortcut: ACTION_KEYS.PLUGIN,
    title: 'Search Plugins',
    description: 'Search and navigate to your plugins',
    search: pluginAction.search,
    isAvailable: () => true,
  })
}

// Legacy export for backward compatibility
export const Actions = {
  slash: slashAction,
  app: appAction,
  knowledge: knowledgeAction,
  plugin: pluginAction,
}

const getScopeId = (scope: ScopeDescriptor | ActionItem) => ('id' in scope ? scope.id : scope.key)

const isSlashScope = (scope: ScopeDescriptor | ActionItem) => scope.shortcut === ACTION_KEYS.SLASH

export const searchAnything = async (
  locale: string,
  query: string,
  scope?: ScopeDescriptor | ActionItem,
  scopes?: (ScopeDescriptor | ActionItem)[],
): Promise<SearchResult[]> => {
  registerDefaultScopes()
  const trimmedQuery = query.trim()

  // Backwards compatibility: if scopes is not provided or empty, use non-page-specific scopes
  const effectiveScopes = (scopes && scopes.length > 0)
    ? scopes
    : scopeRegistry.getScopes({ isWorkflowPage: false, isRagPipelinePage: false })

  if (scope) {
    const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const scopeId = getScopeId(scope)
    const prefixPattern = new RegExp(`^(${escapeRegExp(scope.shortcut)})\\s*`)
    const searchTerm = trimmedQuery.replace(prefixPattern, '').trim()
    try {
      return await scope.search(query, searchTerm, locale)
    }
    catch (error) {
      console.warn(`Search failed for ${scopeId}:`, error)
      return []
    }
  }

  if (trimmedQuery.startsWith('@') || trimmedQuery.startsWith('/'))
    return []

  // Filter out slash commands from general search
  const searchScopes = effectiveScopes.filter(scope => !isSlashScope(scope))

  // Use Promise.allSettled to handle partial failures gracefully
  const searchPromises = searchScopes.map(async (action) => {
    const actionId = getScopeId(action)
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
      const actionKey = getScopeId(searchScopes[index]) || 'unknown'
      failedActions.push(actionKey)
    }
  })

  if (failedActions.length > 0)
    console.warn(`Some search actions failed: ${failedActions.join(', ')}`)

  return allResults
}

// ...

export const matchAction = (query: string, scopes: ScopeDescriptor[]) => {
  registerDefaultScopes()
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return scopes.find((scope) => {
    // Special handling for slash commands
    if (scope.shortcut === ACTION_KEYS.SLASH) {
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
    const reg = new RegExp(`^(${escapeRegExp(scope.shortcut)})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './commands'
export * from './scope-registry'
export * from './types'
export { appAction, knowledgeAction, pluginAction }
