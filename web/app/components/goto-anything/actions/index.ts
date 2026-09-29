import type { ActionItem } from './types'
import { agentAction } from './agent'
import { appAction } from './app'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { ragPipelineNodesAction } from './rag-pipeline-nodes'
import { skillAction } from './skill'
import { workflowNodesAction } from './workflow-nodes'

const defaultActions = {
  app: appAction,
  knowledge: knowledgeAction,
  plugin: pluginAction,
} satisfies Record<string, ActionItem>

type ActionAvailability = {
  agents: boolean
  skills: boolean
}

const defaultAvailability: ActionAvailability = {
  agents: false,
  skills: true,
}

export function createActions(
  slash: ActionItem,
  isWorkflowPage: boolean,
  isRagPipelinePage: boolean,
  availability: ActionAvailability = defaultAvailability,
) {
  const availableActions = {
    ...defaultActions,
    slash,
    ...(availability.skills ? { skill: skillAction } : {}),
    ...(availability.agents ? { agent: agentAction } : {}),
  }

  if (isRagPipelinePage) return { ...availableActions, node: ragPipelineNodesAction }
  if (isWorkflowPage) return { ...availableActions, node: workflowNodesAction }
  return availableActions
}

export function getActionSearchTerm(query: string, action: ActionItem) {
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const prefixPattern = new RegExp(
    `^(${escapeRegExp(action.key)}|${escapeRegExp(action.shortcut)})\\s*`,
  )
  return query.trim().replace(prefixPattern, '').trim()
}

export function matchAction(query: string, actions: Record<string, ActionItem>) {
  return Object.values(actions).find((action) => {
    if (action.matches) return action.matches(query)

    return new RegExp(`^(${action.key}|${action.shortcut})\\s`).test(query)
  })
}
