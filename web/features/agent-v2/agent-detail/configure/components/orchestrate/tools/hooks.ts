'use client'

import type { AgentProviderToolDefaultValue, ToolSettingTarget } from './types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { AgentCliTool, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { useAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import { agentComposerToolsAtom, useRemoveProviderTool, useRemoveProviderToolAction } from '@/features/agent-v2/agent-composer/store-modules/tools'

const toSelectedToolValue = (tool: AgentTool): ToolValue[] => {
  if (tool.kind !== 'provider')
    return []

  return tool.actions.map(action => ({
    provider_name: tool.id,
    tool_name: action.toolName,
    tool_label: action.name,
    tool_description: action.description,
  }))
}

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

export function useAgentToolsOperations() {
  const [tools, setTools] = useAtom(agentComposerToolsAtom)
  const removeProviderTool = useRemoveProviderTool()
  const removeProviderToolAction = useRemoveProviderToolAction()
  const [expandedToolIds, setExpandedToolIds] = useState<Set<string>>(() => new Set())
  const [settingTarget, setSettingTarget] = useState<ToolSettingTarget | null>(null)
  const [isCliToolDialogOpen, setIsCliToolDialogOpen] = useState(false)
  const [editingCliTool, setEditingCliTool] = useState<AgentCliTool | null>(null)

  const setToolOpen = useCallback((tool: AgentTool, open: boolean) => {
    if (tool.kind === 'cli')
      return

    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds)
      if (open)
        nextIds.add(tool.id)
      else
        nextIds.delete(tool.id)

      return nextIds
    })
  }, [])

  const addTools = useCallback((selectedTools: AgentProviderToolDefaultValue[]) => {
    setTools(addProviderTools(tools, selectedTools))
  }, [setTools, tools])

  const deleteCliTool = useCallback((toolId: string) => {
    setTools(tools.filter(tool => tool.id !== toolId))
  }, [setTools, tools])

  const openCliToolDialog = useCallback(() => {
    setEditingCliTool(null)
    setIsCliToolDialogOpen(true)
  }, [])

  const editCliTool = useCallback((tool: AgentCliTool) => {
    setEditingCliTool(tool)
    setIsCliToolDialogOpen(true)
  }, [])

  const handleCliDialogSave = useCallback((tool: AgentCliTool) => {
    if (editingCliTool)
      setTools(tools.map(currentTool => currentTool.id === tool.id ? tool : currentTool))
    else
      setTools([...tools, tool])

    setEditingCliTool(null)
  }, [editingCliTool, setTools, tools])

  const handleCliDialogOpenChange = useCallback((open: boolean) => {
    if (!open)
      setEditingCliTool(null)

    setIsCliToolDialogOpen(open)
  }, [])

  const closeSettingTargetIfRemoved = useCallback((toolId: string, actionId?: string) => {
    setSettingTarget((target) => {
      if (!target || target.tool.id !== toolId)
        return target
      if (actionId && target.action.id !== actionId)
        return target

      return null
    })
  }, [])

  const deleteProviderTool = useCallback((toolId: string) => {
    setExpandedToolIds((currentIds) => {
      const nextIds = new Set(currentIds)
      nextIds.delete(toolId)
      return nextIds
    })
    closeSettingTargetIfRemoved(toolId)
    removeProviderTool(toolId)
  }, [closeSettingTargetIfRemoved, removeProviderTool])

  const deleteProviderToolAction = useCallback((toolId: string, actionId: string) => {
    closeSettingTargetIfRemoved(toolId, actionId)
    removeProviderToolAction(toolId, actionId)
  }, [closeSettingTargetIfRemoved, removeProviderToolAction])

  const closeProviderSettingsDialog = useCallback(() => {
    setSettingTarget(null)
  }, [])

  const selectedTools = useMemo(() => tools.flatMap(toSelectedToolValue), [tools])

  return {
    tools,
    selectedTools,
    expandedToolIds,
    settingTarget,
    isCliToolDialogOpen,
    editingCliTool,
    setTools,
    setToolOpen,
    setSettingTarget,
    addTools,
    deleteCliTool,
    deleteProviderTool,
    deleteProviderToolAction,
    openCliToolDialog,
    editCliTool,
    handleCliDialogSave,
    handleCliDialogOpenChange,
    closeProviderSettingsDialog,
  }
}
