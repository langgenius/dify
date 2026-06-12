'use client'

import type { AgentProviderTool, ToolSettingTarget } from '../types'
import type { Tool } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { CollectionType } from '@/app/components/tools/types'
import { useToolSettings } from '@/features/agent-v2/agent-composer/store-modules/tools'

const localize = (value: string) => ({
  en_US: value,
  zh_Hans: value,
})

const createToolCollection = (tool: AgentProviderTool): ToolWithProvider => ({
  id: tool.id,
  name: tool.id,
  author: tool.name,
  description: localize(`${tool.name} tools`),
  icon: '',
  label: localize(tool.name),
  type: (tool.providerType as CollectionType | undefined) ?? CollectionType.builtIn,
  team_credentials: {},
  is_team_authorization: true,
  allow_delete: false,
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
  onClose,
}: {
  settingTarget: ToolSettingTarget | null
  onClose: () => void
}) {
  const [toolSettings, setToolSettings] = useToolSettings()
  const collection = useMemo(() => {
    if (!settingTarget)
      return null

    return createToolCollection(settingTarget.tool)
  }, [settingTarget])
  const handleSave = useCallback((value: Record<string, unknown>) => {
    if (!settingTarget)
      return

    setToolSettings({
      ...toolSettings,
      [settingTarget.action.id]: value,
    })
    onClose()
  }, [onClose, setToolSettings, settingTarget, toolSettings])

  if (!settingTarget || !collection)
    return null

  return (
    <SettingBuiltInTool
      toolName={settingTarget.action.toolName}
      setting={toolSettings[settingTarget.action.id]}
      collection={collection}
      isModel={false}
      onSave={handleSave}
      onHide={onClose}
    />
  )
}
