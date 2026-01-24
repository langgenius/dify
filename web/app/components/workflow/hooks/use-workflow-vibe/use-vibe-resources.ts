import type { ToolDefaultValue } from '../../block-selector/types'
import type { ToolWithProvider } from '../../types'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useGetLanguage } from '@/context/i18n'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { BlockEnum } from '../../types'
import { useNodesMetaData } from '../use-nodes-meta-data'
import { buildToolParams, normalizeKey, normalizeProviderIcon } from './utils'

export const useVibeResources = () => {
  const { t } = useTranslation('workflow')
  const language = useGetLanguage()
  const { nodesMap: nodesMetaDataMap } = useNodesMetaData()

  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()

  const availableNodesList = useMemo(() => {
    if (!nodesMetaDataMap)
      return []
    return Object.values(nodesMetaDataMap).map(node => ({
      type: node.metaData.type,
      title: node.metaData.title,
      description: node.metaData.description,
    }))
  }, [nodesMetaDataMap])

  const toolOptions = useMemo(() => {
    const collections = [
      buildInTools,
      customTools,
      workflowTools,
      mcpTools,
    ].filter(Boolean) as ToolWithProvider[][]

    const tools: ToolDefaultValue[] = []
    const seen = new Set<string>()

    collections.forEach((collection) => {
      collection.forEach((provider) => {
        provider.tools.forEach((tool) => {
          const key = `${provider.id}:${tool.name}`
          if (seen.has(key))
            return
          seen.add(key)

          const params = buildToolParams(tool.parameters)
          const toolDescription = typeof tool.description === 'object'
            ? tool.description?.[language]
            : tool.description
          tools.push({
            provider_id: provider.id,
            provider_type: provider.type,
            provider_name: provider.name,
            plugin_id: provider.plugin_id,
            plugin_unique_identifier: provider.plugin_unique_identifier,
            provider_icon: normalizeProviderIcon(provider.icon),
            provider_icon_dark: normalizeProviderIcon(provider.icon_dark),
            tool_name: tool.name,
            tool_label: tool.label[language] || tool.name,
            tool_description: toolDescription || '',
            title: tool.label[language] || tool.name,
            is_team_authorization: provider.is_team_authorization,
            paramSchemas: tool.parameters,
            params,
            output_schema: tool.output_schema,
            meta: provider.meta,
          })
        })
      })
    })

    return tools
  }, [buildInTools, customTools, workflowTools, mcpTools, language])

  const toolLookup = useMemo(() => {
    const map = new Map<string, ToolDefaultValue>()
    toolOptions.forEach((tool) => {
      // Primary key: provider_id/tool_name (e.g., "google/google_search")
      const primaryKey = normalizeKey(`${tool.provider_id}/${tool.tool_name}`)
      map.set(primaryKey, tool)

      // Fallback 1: provider_name/tool_name (e.g., "Google/google_search")
      const providerNameKey = normalizeKey(`${tool.provider_name}/${tool.tool_name}`)
      map.set(providerNameKey, tool)

      // Fallback 2: tool_label (display name)
      const labelKey = normalizeKey(tool.tool_label)
      map.set(labelKey, tool)

      // Fallback 3: tool_name alone (for partial matching when model omits provider)
      const toolNameKey = normalizeKey(tool.tool_name)
      if (!map.has(toolNameKey)) {
        // Only set if not already taken (avoid collisions between providers)
        map.set(toolNameKey, tool)
      }
    })
    return map
  }, [toolOptions])

  const nodeTypeLookup = useMemo(() => {
    const map = new Map<string, BlockEnum>()
    if (!nodesMetaDataMap)
      return map
    Object.values(nodesMetaDataMap).forEach((node) => {
      map.set(normalizeKey(node.metaData.type), node.metaData.type)
      if (node.metaData.title)
        map.set(normalizeKey(node.metaData.title), node.metaData.type)
    })
    map.set('ifelse', BlockEnum.IfElse)
    map.set('ifelsecase', BlockEnum.IfElse)
    return map
  }, [nodesMetaDataMap])

  return {
    nodesMetaDataMap,
    availableNodesList,
    toolOptions,
    toolLookup,
    nodeTypeLookup,
    t,
    language,
  }
}
