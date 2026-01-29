import type { TriggerWithProvider } from '../block-selector/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { CommonNodeType, ToolWithProvider } from '../types'
import { CollectionType } from '@/app/components/tools/types'
import { canFindTool } from '@/utils'
import { BlockEnum } from '../types'

export const PLUGIN_DEPENDENT_TYPES: BlockEnum[] = [
  BlockEnum.Tool,
  BlockEnum.DataSource,
  BlockEnum.TriggerPlugin,
]

export function isPluginDependentNode(type: string): boolean {
  return PLUGIN_DEPENDENT_TYPES.includes(type as BlockEnum)
}

export function matchToolInCollection(
  collection: ToolWithProvider[],
  data: { plugin_id?: string, provider_id?: string, provider_name?: string },
): ToolWithProvider | undefined {
  return collection.find(t =>
    (data.plugin_id && t.plugin_id === data.plugin_id)
    || canFindTool(t.id, data.provider_id)
    || t.name === data.provider_name,
  )
}

export function matchTriggerProvider(
  providers: TriggerWithProvider[],
  data: { provider_name?: string, provider_id?: string, plugin_id?: string },
): TriggerWithProvider | undefined {
  return providers.find(p =>
    p.name === data.provider_name
    || p.id === data.provider_id
    || (data.plugin_id && p.plugin_id === data.plugin_id),
  )
}

export function matchDataSource(
  list: ToolWithProvider[],
  data: { plugin_unique_identifier?: string, plugin_id?: string, provider_name?: string },
): ToolWithProvider | undefined {
  return list.find(item =>
    (data.plugin_unique_identifier && item.plugin_unique_identifier === data.plugin_unique_identifier)
    || (data.plugin_id && item.plugin_id === data.plugin_id)
    || (data.provider_name && item.provider === data.provider_name),
  )
}

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
      return !matchToolInCollection(collection, toolData) && Boolean(toolData.plugin_unique_identifier)
    }
    case BlockEnum.TriggerPlugin: {
      const triggerData = data as PluginTriggerNodeType
      if (!context.triggerPlugins)
        return false
      return !matchTriggerProvider(context.triggerPlugins, triggerData) && Boolean(triggerData.plugin_unique_identifier)
    }
    case BlockEnum.DataSource: {
      const dsData = data as DataSourceNodeType
      if (!context.dataSourceList)
        return false
      return !matchDataSource(context.dataSourceList, dsData) && Boolean(dsData.plugin_unique_identifier)
    }
    default:
      return false
  }
}
