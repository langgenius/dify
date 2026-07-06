'use client'

import type { ToolSettingTarget } from '../types'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentProviderTool } from '@/features/agent-v2/agent-composer/form-state'
import { useAtomValue, useSetAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { CollectionType } from '@/app/components/tools/types'
import {
  agentComposerToolsAtom,
  agentComposerToolSettingsAtom,
  saveProviderToolActionSettingsAtom,
} from '@/features/agent-v2/agent-composer/store-modules/tools'

const localize = (value: string) => ({
  en_US: value,
  zh_Hans: value,
})

const createFallbackToolCollection = (tool: AgentProviderTool): ToolWithProvider => ({
  id: tool.id,
  name: tool.id,
  author: tool.name,
  description: localize(`${tool.name} tools`),
  icon: tool.icon ?? '',
  icon_dark: tool.iconDark,
  label: localize(tool.displayName ?? tool.name),
  type: (tool.providerType as CollectionType | undefined) ?? CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: tool.allowDelete ?? false,
  labels: [],
  meta: {
    version: '0.0.0',
  },
  tools: tool.actions.map<Tool>(action => ({
    name: action.toolName,
    author: tool.name,
    label: localize(action.name),
    description: localize(action.description),
    parameters: [],
    labels: [],
    output_schema: {},
  })),
}) as ToolWithProvider

export function ProviderToolSettingsDialog({
  settingTarget,
  collection,
  onClose,
}: {
  settingTarget: ToolSettingTarget | null
  collection?: ToolWithProvider
  onClose: () => void
}) {
  const tools = useAtomValue(agentComposerToolsAtom)
  const toolSettings = useAtomValue(agentComposerToolSettingsAtom)
  const saveProviderToolActionSettings = useSetAtom(saveProviderToolActionSettingsAtom)
  const currentTarget = useMemo(() => {
    if (!settingTarget)
      return null

    const tool = tools.find(tool => tool.kind === 'provider' && tool.id === settingTarget.toolId)
    if (tool?.kind !== 'provider')
      return null

    const action = tool.actions.find(action => action.id === settingTarget.actionId)
    if (!action)
      return null

    return { action, tool }
  }, [settingTarget, tools])
  const toolCollection = useMemo(() => {
    if (!currentTarget)
      return null

    return collection ?? createFallbackToolCollection(currentTarget.tool)
  }, [collection, currentTarget])
  const handleSave = useCallback((value: Record<string, unknown>) => {
    if (!currentTarget)
      return

    saveProviderToolActionSettings({
      actionId: currentTarget.action.id,
      value,
    })
    onClose()
  }, [currentTarget, onClose, saveProviderToolActionSettings])

  if (!currentTarget || !toolCollection)
    return null

  return (
    <SettingBuiltInTool
      toolName={currentTarget.action.toolName}
      setting={toolSettings[currentTarget.action.id]}
      collection={toolCollection}
      isModel={false}
      credentialId={currentTarget.tool.credentialId}
      onSave={handleSave}
      onHide={onClose}
    />
  )
}
