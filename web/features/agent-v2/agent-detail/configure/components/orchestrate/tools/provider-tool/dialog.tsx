'use client'

import type { AgentProviderTool, ToolSettingTarget } from '../types'
import type { Tool, ToolParameter } from '@/app/components/tools/types'
import type { ToolWithProvider } from '@/app/components/workflow/types'
import { useCallback, useMemo } from 'react'
import SettingBuiltInTool from '@/app/components/app/configuration/config/agent/agent-tools/setting-built-in-tool'
import { CollectionType } from '@/app/components/tools/types'
import { useToolSettings } from '@/features/agent-v2/agent-composer/store'

const localize = (value: string) => ({
  en_US: value,
  zh_Hans: value,
})

const mockSettingParameter = (name: string): ToolParameter => ({
  name,
  label: localize(name === 'used_in_agent_nodes' ? 'Used in Agent nodes' : 'Query'),
  human_description: localize(name === 'used_in_agent_nodes'
    ? 'Whether this tool can be used by agent nodes.'
    : 'The input query passed to this tool.'),
  type: name === 'used_in_agent_nodes' ? 'boolean' : 'string',
  form: name === 'used_in_agent_nodes' ? 'form' : 'llm',
  llm_description: name === 'used_in_agent_nodes'
    ? 'Whether this tool can be used by agent nodes.'
    : 'Search query or URL input for the tool.',
  required: name !== 'used_in_agent_nodes',
  multiple: false,
  default: '',
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
    parameters: [
      mockSettingParameter('used_in_agent_nodes'),
      mockSettingParameter('query'),
    ],
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
