import { appAction } from './app'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { workflowNodesAction } from './workflow-nodes'
import type { ActionItem, SearchResult } from './types'

export const Actions = {
  app: appAction,
  knowledge: knowledgeAction,
  plugin: pluginAction,
  node: workflowNodesAction,
}

export const searchAnything = async (
  locale: string,
  query: string,
  actionItem?: ActionItem,
): Promise<SearchResult[]> => {
  if (actionItem) {
    const searchTerm = query.replace(actionItem.key, '').replace(actionItem.shortcut, '').trim()
    return await actionItem.search(query, searchTerm, locale)
  }

  if (query.startsWith('@'))
    return []

  return (await Promise.all(Object.values(Actions).map(actionItem => actionItem.search(query, query, locale)))).flat()
}

export const matchAction = (query: string, actions: Record<string, ActionItem>) => {
  return Object.values(actions).find((action) => {
    const reg = new RegExp(`^(${action.key}|${action.shortcut})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './types'
export { appAction, knowledgeAction, pluginAction, workflowNodesAction }
