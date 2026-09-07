import type { ActionItem } from './types'
import { agentAction } from './agent'
import { appAction } from './app'
import { slashCommandRegistry } from './commands/registry'
import { slashAction } from './commands/slash'
import { knowledgeAction } from './knowledge'
import { pluginAction } from './plugin'
import { ragPipelineNodesAction } from './rag-pipeline-nodes'
import { skillAction } from './skill'
import { workflowNodesAction } from './workflow-nodes'

const defaultActions = {
  slash: slashAction,
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
  isWorkflowPage: boolean,
  isRagPipelinePage: boolean,
  availability: ActionAvailability = defaultAvailability,
) {
  const availableActions = {
    ...defaultActions,
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
    if (action.key === '/') {
      return slashCommandRegistry.getAllCommands().some((command) => {
        if (command.mode === 'direct') return false

        const commandPattern = `/${command.name}`
        return query.startsWith(`${commandPattern} `)
      })
    }

    return new RegExp(`^(${action.key}|${action.shortcut})\\s`).test(query)
  })
}
