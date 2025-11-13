import { useCallback, useMemo } from 'react'
import type { Node, ToolWithProvider } from '../types'
import { BlockEnum } from '../types'
import { useStore, useWorkflowStore } from '../store'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { TriggerWithProvider } from '../block-selector/types'

const isTriggerPluginNode = (data: Node['data']): data is PluginTriggerNodeType => data.type === BlockEnum.TriggerPlugin

const isToolNode = (data: Node['data']): data is ToolNodeType => data.type === BlockEnum.Tool

const isDataSourceNode = (data: Node['data']): data is DataSourceNodeType => data.type === BlockEnum.DataSource

const findTriggerPluginIcon = (
  identifiers: (string | undefined)[],
  triggers: TriggerWithProvider[] | undefined,
) => {
  const targetTriggers = triggers || []
  for (const identifier of identifiers) {
    if (!identifier)
      continue
    const matched = targetTriggers.find(trigger => trigger.id === identifier || canFindTool(trigger.id, identifier))
    if (matched?.icon)
      return matched.icon
  }
  return undefined
}

export const useToolIcon = (data?: Node['data']) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const { data: triggerPlugins } = useAllTriggerPlugins()

  const toolIcon = useMemo(() => {
    if (!data)
      return ''

    if (isTriggerPluginNode(data)) {
      const icon = findTriggerPluginIcon(
        [
          data.plugin_id,
          data.provider_id,
          data.provider_name,
        ],
        triggerPlugins,
      )
      if (icon)
        return icon
    }

    if (isToolNode(data)) {
      let primaryCollection: ToolWithProvider[] | undefined
      switch (data.provider_type) {
        case CollectionType.custom:
          primaryCollection = customTools
          break
        case CollectionType.mcp:
          primaryCollection = mcpTools
          break
        case CollectionType.workflow:
          primaryCollection = workflowTools
          break
        case CollectionType.builtIn:
        default:
          primaryCollection = buildInTools
          break
      }

      const collectionsToSearch = [
        primaryCollection,
        buildInTools,
        customTools,
        workflowTools,
        mcpTools,
      ] as Array<ToolWithProvider[] | undefined>

      const seen = new Set<ToolWithProvider[]>()
      for (const collection of collectionsToSearch) {
        if (!collection || seen.has(collection))
          continue
        seen.add(collection)
        const matched = collection.find((toolWithProvider) => {
          if (canFindTool(toolWithProvider.id, data.provider_id))
            return true
          if (data.plugin_id && toolWithProvider.plugin_id === data.plugin_id)
            return true
          return data.provider_name === toolWithProvider.name
        })
        if (matched?.icon)
          return matched.icon
      }

      if (data.provider_icon)
        return data.provider_icon

      return ''
    }

    if (isDataSourceNode(data))
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon || ''

    return ''
  }, [data, dataSourceList, buildInTools, customTools, workflowTools, mcpTools, triggerPlugins])

  return toolIcon
}

export const useGetToolIcon = () => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const workflowStore = useWorkflowStore()

  const getToolIcon = useCallback((data: Node['data']) => {
    const {
      buildInTools: storeBuiltInTools,
      customTools: storeCustomTools,
      workflowTools: storeWorkflowTools,
      mcpTools: storeMcpTools,
      dataSourceList,
    } = workflowStore.getState()

    if (isTriggerPluginNode(data)) {
      return findTriggerPluginIcon(
        [
          data.plugin_id,
          data.provider_id,
          data.provider_name,
        ],
        triggerPlugins,
      )
    }

    if (isToolNode(data)) {
      const primaryCollection = (() => {
        switch (data.provider_type) {
          case CollectionType.custom:
            return storeCustomTools ?? customTools
          case CollectionType.mcp:
            return storeMcpTools ?? mcpTools
          case CollectionType.workflow:
            return storeWorkflowTools ?? workflowTools
          case CollectionType.builtIn:
          default:
            return storeBuiltInTools ?? buildInTools
        }
      })()

      const collectionsToSearch = [
        primaryCollection,
        storeBuiltInTools ?? buildInTools,
        storeCustomTools ?? customTools,
        storeWorkflowTools ?? workflowTools,
        storeMcpTools ?? mcpTools,
      ] as Array<ToolWithProvider[] | undefined>

      const seen = new Set<ToolWithProvider[]>()
      for (const collection of collectionsToSearch) {
        if (!collection || seen.has(collection))
          continue
        seen.add(collection)
        const matched = collection.find((toolWithProvider) => {
          if (canFindTool(toolWithProvider.id, data.provider_id))
            return true
          if (data.plugin_id && toolWithProvider.plugin_id === data.plugin_id)
            return true
          return data.provider_name === toolWithProvider.name
        })
        if (matched?.icon)
          return matched.icon
      }

      if (data.provider_icon)
        return data.provider_icon

      return undefined
    }

    if (isDataSourceNode(data))
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon

    return undefined
  }, [workflowStore, triggerPlugins, buildInTools, customTools, workflowTools, mcpTools])

  return getToolIcon
}
