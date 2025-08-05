import { appAction } from './app'
import { knowledgeAction } from './knowledge'
import { toolsAction } from './tools'
import type { ActionItem, SearchResult } from './types'

export const Actions = {
  app: appAction,
  knowledge: knowledgeAction,
  tools: toolsAction,
}

export const searchAnything = async (query: string, actionItem?: ActionItem): Promise<SearchResult[]> => {
  if (actionItem) {
    const searchTerm = query.replace(actionItem.key, '').replace(actionItem.shortcut, '').trim()
    return await actionItem.search(query, searchTerm)
  }
  else if(query.startsWith('@')){
    return []
  }
  else {
    return (await Promise.all(Object.values(Actions).map(actionItem => actionItem.search(query)))).flat()
  }
}

export const matchAction = (query: string, actions: Record<string, ActionItem>) => {
  return Object.values(actions).find(action => {
    const reg = new RegExp(`^(${action.key}|${action.shortcut})(?:\\s|$)`)
    return reg.test(query)
  })
}

export * from './types'
export { appAction, knowledgeAction, toolsAction }
