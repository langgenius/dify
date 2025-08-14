import { appAction } from './app'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { workflowNodesAction } from './workflow-nodes'
import type { ActionItem, SearchResult } from './types'
import { commandAction } from './run'

export const Actions = {
  app: appAction,
  knowledge: knowledgeAction,
  plugin: pluginAction,
  run: commandAction,
  node: workflowNodesAction,
}

export const searchAnything = async (
  locale: string,
  query: string,
  actionItem?: ActionItem,
): Promise<SearchResult[]> => {
  if (actionItem) {
    const searchTerm = query.replace(actionItem.key, '').replace(actionItem.shortcut, '').trim()
    try {
      return await actionItem.search(query, searchTerm, locale)
    }
    catch (error) {
      console.warn(`Search failed for ${actionItem.key}:`, error)
      return []
    }
  }

  if (query.startsWith('@'))
    return []

  // Use Promise.allSettled to handle partial failures gracefully
  const searchPromises = Object.values(Actions).map(async (action) => {
    try {
      const results = await action.search(query, query, locale)
      return { success: true, data: results, actionType: action.key }
    }
 catch (error) {
      console.warn(`Search failed for ${action.key}:`, error)
      return { success: false, data: [], actionType: action.key, error }
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
      const actionKey = Object.values(Actions)[index]?.key || 'unknown'
      failedActions.push(actionKey)
    }
  })

  if (failedActions.length > 0)
    console.warn(`Some search actions failed: ${failedActions.join(', ')}`)

  return allResults
}

export const matchAction = (query: string, actions: Record<string, ActionItem>) => {
  return Object.values(actions).find((action) => {
    const reg = new RegExp(`^(${action.key}|${action.shortcut})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './types'
export { appAction, knowledgeAction, pluginAction, workflowNodesAction }
