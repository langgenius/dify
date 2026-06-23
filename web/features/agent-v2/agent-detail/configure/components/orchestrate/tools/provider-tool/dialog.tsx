'use client'

import type { ToolSettingTarget } from '../types'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import type { AgentProviderTool } from '@/features/agent-v2/agent-composer/form-state'
import { useAtom } from 'jotai'
import { useCallback, useMemo } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { CollectionType } from '@/app/components/tools/types'
import { agentComposerToolSettingsAtom } from '@/features/agent-v2/agent-composer/store-modules/tools'

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
  const [toolSettings, setToolSettings] = useAtom(agentComposerToolSettingsAtom)
  const toolCollection = useMemo(() => {
    if (!settingTarget)
      return null

    return collection ?? createFallbackToolCollection(settingTarget.tool)
  }, [collection, settingTarget])
  const handleSave = useCallback((value: Record<string, unknown>) => {
    if (!settingTarget)
      return

    setToolSettings({
      ...toolSettings,
      [settingTarget.action.id]: value,
    })
    onClose()
  }, [onClose, setToolSettings, settingTarget, toolSettings])

  if (!settingTarget || !toolCollection)
    return null

  return (
    <SettingBuiltInTool
      toolName={settingTarget.action.toolName}
      setting={toolSettings[settingTarget.action.id]}
      collection={toolCollection}
      isModel={false}
      credentialId={settingTarget.tool.credentialId}
      onSave={handleSave}
      onHide={onClose}
    />
  )
}
