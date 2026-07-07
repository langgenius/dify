import type { AgentCliTool, AgentProviderTool, AgentSoulConfigFormState, AgentTool } from '../form-state'
import type { DraftFieldUpdate } from './utils'
import type { ToolDefaultValue } from '@/app/components/workflow/block-selector/types'
import { atom } from 'jotai'
import { syncCliToolReferenceLabels } from '../reference-labels'
import { agentComposerDraftAtom } from '../store'
import { resolveDraftFieldUpdate } from './utils'

export type AgentProviderToolDefaultValue = ToolDefaultValue & {
  allowDelete?: boolean
  credentialType?: AgentProviderTool['credentialType']
  credentialRequired?: boolean
}

export const agentComposerToolsAtom = atom(
  get => get(agentComposerDraftAtom).tools,
  (get, set, toolsUpdate: DraftFieldUpdate<AgentTool[]>) => {
    const draft = get(agentComposerDraftAtom)
    const tools = resolveDraftFieldUpdate(draft.tools, toolsUpdate)

    set(agentComposerDraftAtom, {
      ...draft,
      prompt: syncCliToolReferenceLabels({
        prompt: draft.prompt,
        currentTools: draft.tools,
        nextTools: tools,
      }),
      tools,
    })
  },
)

const toProviderToolAction = (tool: AgentProviderToolDefaultValue) => ({
  id: `${tool.provider_id}:${tool.tool_name}`,
  name: tool.tool_label || tool.title || tool.tool_name,
  toolName: tool.tool_name,
  description: tool.tool_description || '',
})

const getCredentialVariant = (tool: AgentProviderToolDefaultValue) => {
  if (!tool.credentialRequired)
    return 'none' as const

  if (!tool.allowDelete)
    return tool.credential_id ? 'authorized' as const : 'unauthorized' as const

  return tool.is_team_authorization ? 'authorized' as const : 'unauthorized' as const
}

const getCredentialType = (tool: AgentProviderToolDefaultValue) => {
  if (!tool.credentialRequired)
    return undefined

  if (tool.credentialType === 'oauth2')
    return 'oauth2' as const

  if (!tool.allowDelete)
    return tool.credential_id ? 'api-key' as const : 'unauthorized' as const

  return tool.is_team_authorization ? 'api-key' as const : 'unauthorized' as const
}

export const addProviderTools = (
  currentTools: AgentTool[],
  selectedTools: AgentProviderToolDefaultValue[],
): AgentTool[] => {
  if (selectedTools.length === 0)
    return currentTools

  const nextTools = [...currentTools]

  selectedTools.forEach((selectedTool) => {
    const action = toProviderToolAction(selectedTool)
    const existingToolIndex = nextTools.findIndex(tool => tool.kind === 'provider' && tool.id === selectedTool.provider_id)
    const existingTool = nextTools[existingToolIndex]

    if (existingTool?.kind === 'provider') {
      if (existingTool.actions.some(existingAction => existingAction.toolName === action.toolName))
        return

      nextTools[existingToolIndex] = {
        ...existingTool,
        displayName: existingTool.displayName ?? selectedTool.provider_show_name,
        icon: existingTool.icon ?? selectedTool.provider_icon,
        iconDark: existingTool.iconDark ?? selectedTool.provider_icon_dark,
        allowDelete: existingTool.allowDelete ?? selectedTool.allowDelete,
        actions: [...existingTool.actions, action],
      }
      return
    }

    nextTools.push({
      id: selectedTool.provider_id,
      name: selectedTool.provider_name,
      kind: 'provider',
      displayName: selectedTool.provider_show_name,
      iconClassName: 'i-custom-public-other-default-tool-icon text-text-tertiary',
      icon: selectedTool.provider_icon,
      iconDark: selectedTool.provider_icon_dark,
      providerType: selectedTool.provider_type,
      allowDelete: selectedTool.allowDelete,
      credentialId: selectedTool.credential_id,
      credentialKey: selectedTool.is_team_authorization
        ? 'agentDetail.configure.tools.credential.authOne'
        : undefined,
      credentialType: getCredentialType(selectedTool),
      credentialVariant: getCredentialVariant(selectedTool),
      actions: [action],
    })
  })

  return nextTools
}

export const addProviderToolsAtom = atom(null, (_get, set, selectedTools: AgentProviderToolDefaultValue[]) => {
  set(agentComposerToolsAtom, tools => addProviderTools(tools, selectedTools))
})

export const saveCliToolAtom = atom(null, (_get, set, cliTool: AgentCliTool) => {
  set(agentComposerToolsAtom, tools => (
    tools.some(tool => tool.kind === 'cli' && tool.id === cliTool.id)
      ? tools.map(tool => tool.id === cliTool.id ? cliTool : tool)
      : [...tools, cliTool]
  ))
})

export const removeCliToolAtom = atom(null, (_get, set, toolId: string) => {
  set(agentComposerToolsAtom, tools => tools.filter(tool => tool.id !== toolId))
})

export const agentComposerToolSettingsAtom = atom(
  get => get(agentComposerDraftAtom).toolSettings,
  (get, set, toolSettingsUpdate: DraftFieldUpdate<Record<string, Record<string, unknown>>>) => {
    const draft = get(agentComposerDraftAtom)

    set(agentComposerDraftAtom, {
      ...draft,
      toolSettings: resolveDraftFieldUpdate(draft.toolSettings, toolSettingsUpdate),
    })
  },
)

const omitToolSettings = (
  toolSettings: AgentSoulConfigFormState['toolSettings'],
  actionIds: string[],
) => {
  const nextToolSettings = { ...toolSettings }

  actionIds.forEach((actionId) => {
    delete nextToolSettings[actionId]
  })

  return nextToolSettings
}

export const removeProviderToolAtom = atom(null, (get, set, toolId: string) => {
  const draft = get(agentComposerDraftAtom)
  const toolToRemove = draft.tools.find(tool => tool.kind === 'provider' && tool.id === toolId)
  const actionIds = toolToRemove?.kind === 'provider'
    ? toolToRemove.actions.map(action => action.id)
    : []

  set(agentComposerDraftAtom, {
    ...draft,
    tools: draft.tools.filter(tool => tool.id !== toolId),
    toolSettings: omitToolSettings(draft.toolSettings, actionIds),
  })
})

export const removeProviderToolActionAtom = atom(null, (get, set, {
  toolId,
  actionId,
}: {
  toolId: string
  actionId: string
}) => {
  const draft = get(agentComposerDraftAtom)

  set(agentComposerDraftAtom, {
    ...draft,
    tools: draft.tools.flatMap((tool) => {
      if (tool.kind !== 'provider' || tool.id !== toolId)
        return [tool]

      const nextActions = tool.actions.filter(action => action.id !== actionId)
      return nextActions.length > 0
        ? [{ ...tool, actions: nextActions }]
        : []
    }),
    toolSettings: omitToolSettings(draft.toolSettings, [actionId]),
  })
})

export const setProviderToolCredentialAtom = atom(null, (_get, set, {
  toolId,
  credentialId,
  credentialType,
}: {
  toolId: string
  credentialId?: string
  credentialType?: AgentProviderTool['credentialType']
}) => {
  set(agentComposerToolsAtom, tools => tools.map((tool) => {
    if (tool.kind !== 'provider' || tool.id !== toolId)
      return tool

    const nextCredentialType = credentialType === 'oauth2' || tool.credentialType === 'oauth2'
      ? 'oauth2'
      : 'api-key'

    return {
      ...tool,
      credentialId,
      credentialType: nextCredentialType,
      credentialVariant: 'authorized',
    }
  }))
})

export const saveProviderToolActionSettingsAtom = atom(null, (_get, set, {
  actionId,
  value,
}: {
  actionId: string
  value: Record<string, unknown>
}) => {
  set(agentComposerToolSettingsAtom, toolSettings => ({
    ...toolSettings,
    [actionId]: value,
  }))
})
