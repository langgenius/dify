import type { TriggerWithProvider } from '../block-selector/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { CommonNodeType, ToolWithProvider } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'
import { BlockEnum } from '../types'

export type PluginInstallCheckContext = {
  builtInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
  triggerPlugins?: TriggerWithProvider[]
  dataSourceList?: ToolWithProvider[]
}

export function isNodePluginMissing(
  data: CommonNodeType,
  context: PluginInstallCheckContext,
): boolean {
  switch (data.type as BlockEnum) {
    case BlockEnum.Tool: {
      const toolData = data as ToolNodeType
      const collectionMap: Partial<Record<CollectionType, ToolWithProvider[] | undefined>> = {
        [CollectionType.builtIn]: context.builtInTools,
        [CollectionType.custom]: context.customTools,
        [CollectionType.workflow]: context.workflowTools,
        [CollectionType.mcp]: context.mcpTools,
      }
      const collection = collectionMap[toolData.provider_type]
      if (!collection)
        return false
      const matched = collection.find(t =>
        (toolData.plugin_id && t.plugin_id === toolData.plugin_id)
        || canFindTool(t.id, toolData.provider_id)
        || t.name === toolData.provider_name,
      )
      return !matched && Boolean(toolData.plugin_unique_identifier)
    }
    case BlockEnum.TriggerPlugin: {
      const triggerData = data as PluginTriggerNodeType
      if (!context.triggerPlugins)
        return false
      const matched = context.triggerPlugins.find(p =>
        p.name === triggerData.provider_name
        || p.id === triggerData.provider_id
        || (triggerData.plugin_id && p.plugin_id === triggerData.plugin_id),
      )
      return !matched && Boolean(triggerData.plugin_unique_identifier)
    }
    case BlockEnum.DataSource: {
      const dsData = data as DataSourceNodeType
      if (!context.dataSourceList)
        return false
      const matched = context.dataSourceList.find(item =>
        (dsData.plugin_unique_identifier && item.plugin_unique_identifier === dsData.plugin_unique_identifier)
        || (dsData.plugin_id && item.plugin_id === dsData.plugin_id)
        || (dsData.provider_name && item.provider === dsData.provider_name),
      )
      return !matched && Boolean(dsData.plugin_unique_identifier)
    }
    default:
      return false
  }
}
