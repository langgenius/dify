import { appAction } from './app'
import { knowledgeAction } from './knowledge'
import { toolsAction } from './tools'
import type { ActionItem } from './types'

export const Actions = {
  app: appAction,
  knowledge: knowledgeAction,
  tools: toolsAction,
}

export const searchAnything = (query: string, actionItem?: ActionItem) => {
  if (actionItem) {
    const searchTerm = query.replace(actionItem.key, '').replace(actionItem.shortcut, '').trim()
    return actionItem.search(query, searchTerm)
  }
  else {
    return Object.values(Actions)
      .flatMap(actionItem => actionItem.search(query))
  }
}

export * from './types'
export { appAction, knowledgeAction, toolsAction }
