'use client'

import type { ToolSettingTarget } from './types'
import type { ToolValue } from '@/app/components/workflow/block-selector/types'
import type { AgentCliTool, AgentTool } from '@/features/agent-v2/agent-composer/form-state'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo, useState } from 'react'
import {
  agentComposerToolsAtom,
  removeCliToolAtom,
  removeProviderToolActionAtom,
  removeProviderToolAtom,
  saveCliToolAtom,
} from '@/features/agent-v2/agent-composer/store-modules/tools'

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

export function useSelectedProviderTools() {
  const tools = useAtomValue(agentComposerToolsAtom)

  return useMemo(() => tools.flatMap(toSelectedToolValue), [tools])
}

export function useProviderToolSettingsSurface() {
  const removeProviderTool = useSetAtom(removeProviderToolAtom)
  const removeProviderToolAction = useSetAtom(removeProviderToolActionAtom)
  const [settingTarget, setSettingTarget] = useState<ToolSettingTarget | null>(null)

  const closeSettingTargetIfRemoved = useCallback((toolId: string, actionId?: string) => {
    setSettingTarget((target) => {
      if (!target || target.toolId !== toolId)
        return target
      if (actionId && target.actionId !== actionId)
        return target

      return null
    })
  }, [])

  const deleteProviderTool = useCallback((toolId: string) => {
    closeSettingTargetIfRemoved(toolId)
    removeProviderTool(toolId)
  }, [closeSettingTargetIfRemoved, removeProviderTool])

  const deleteProviderToolAction = useCallback((toolId: string, actionId: string) => {
    closeSettingTargetIfRemoved(toolId, actionId)
    removeProviderToolAction({ toolId, actionId })
  }, [closeSettingTargetIfRemoved, removeProviderToolAction])

  const closeProviderSettingsDialog = useCallback(() => {
    setSettingTarget(null)
  }, [])

  return {
    settingTarget,
    setSettingTarget,
    deleteProviderTool,
    deleteProviderToolAction,
    closeProviderSettingsDialog,
  }
}

export function useCliToolDialogSurface() {
  const saveCliTool = useSetAtom(saveCliToolAtom)
  const removeCliTool = useSetAtom(removeCliToolAtom)
  const [isCliToolDialogOpen, setIsCliToolDialogOpen] = useState(false)
  const [editingCliTool, setEditingCliTool] = useState<AgentCliTool | null>(null)

  const openCliToolDialog = useCallback(() => {
    setEditingCliTool(null)
    setIsCliToolDialogOpen(true)
  }, [])

  const editCliTool = useCallback((tool: AgentCliTool) => {
    setEditingCliTool(tool)
    setIsCliToolDialogOpen(true)
  }, [])

  const handleCliDialogSave = useCallback((tool: AgentCliTool) => {
    saveCliTool(tool)
    setEditingCliTool(null)
  }, [saveCliTool])

  const handleCliDialogOpenChange = useCallback((open: boolean) => {
    if (!open)
      setEditingCliTool(null)

    setIsCliToolDialogOpen(open)
  }, [])

  return {
    isCliToolDialogOpen,
    editingCliTool,
    deleteCliTool: removeCliTool,
    openCliToolDialog,
    editCliTool,
    handleCliDialogSave,
    handleCliDialogOpenChange,
  }
}
