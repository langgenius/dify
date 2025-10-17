import {
  useCallback,
  useMemo,
} from 'react'
import type {
  Node,
} from '../types'
import {
  BlockEnum,
} from '../types'
import {
  useStore,
  useWorkflowStore,
} from '../store'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { TriggerWithProvider } from '../block-selector/types'

const isTriggerPluginNode = (data: Node['data']): data is PluginTriggerNodeType => {
  return data.type === BlockEnum.TriggerPlugin
}

const isToolNode = (data: Node['data']): data is ToolNodeType => {
  return data.type === BlockEnum.Tool
}

const isDataSourceNode = (data: Node['data']): data is DataSourceNodeType => {
  return data.type === BlockEnum.DataSource
}

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
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const mcpTools = useStore(s => s.mcpTools)
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
      return icon || ''
    }
    if (isToolNode(data)) {
      // eslint-disable-next-line sonarjs/no-dead-store
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else if (data.provider_type === CollectionType.mcp)
        targetTools = mcpTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon || ''
    }
    if (isDataSourceNode(data))
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon || ''
    return ''
  }, [data, dataSourceList, buildInTools, customTools, mcpTools, workflowTools, triggerPlugins])

  return toolIcon
}

export const useGetToolIcon = () => {
  const workflowStore = useWorkflowStore()
  const { data: triggerPlugins } = useAllTriggerPlugins()

  const getToolIcon = useCallback((data: Node['data']) => {
    const {
      buildInTools,
      customTools,
      workflowTools,
      mcpTools,
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
      // eslint-disable-next-line sonarjs/no-dead-store
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else if (data.provider_type === CollectionType.mcp)
        targetTools = mcpTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }

    if (isDataSourceNode(data))
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon

    return undefined
  }, [workflowStore, triggerPlugins])

  return getToolIcon
}
