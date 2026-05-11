import type { TriggerWithProvider } from '../block-selector/types'
import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { Node, ToolWithProvider } from '../types'
import { useCallback, useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import useTheme from '@/hooks/use-theme'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'
import { canFindTool } from '@/utils'
import { useStore, useWorkflowStore } from '../store'
import { BlockEnum } from '../types'

const isTriggerPluginNode = (data: Node['data']): data is PluginTriggerNodeType => data.type === BlockEnum.TriggerPlugin

const isToolNode = (data: Node['data']): data is ToolNodeType => data.type === BlockEnum.Tool

const isDataSourceNode = (data: Node['data']): data is DataSourceNodeType => data.type === BlockEnum.DataSource

type IconValue = ToolWithProvider['icon']
type ToolCollections = {
  buildInTools?: ToolWithProvider[]
  customTools?: ToolWithProvider[]
  workflowTools?: ToolWithProvider[]
  mcpTools?: ToolWithProvider[]
}

const resolveIconByTheme = (
  currentTheme: string | undefined,
  icon?: IconValue,
  iconDark?: IconValue,
) => {
  if (currentTheme === 'dark' && iconDark)
    return iconDark
  return icon
}

const findTriggerPluginIcon = (
  identifiers: (string | undefined)[],
  triggers: TriggerWithProvider[] | undefined,
  currentTheme?: string,
) => {
  const targetTriggers = triggers || []
  for (const identifier of identifiers) {
    if (!identifier)
      continue
    const matched = targetTriggers.find(trigger => trigger.id === identifier || canFindTool(trigger.id, identifier))
    if (matched)
      return resolveIconByTheme(currentTheme, matched.icon, matched.icon_dark)
  }
  return undefined
}

const getPrimaryToolCollection = (
  providerType: CollectionType | undefined,
  collections: ToolCollections,
) => {
  switch (providerType) {
    case CollectionType.custom:
      return collections.customTools
    case CollectionType.mcp:
      return collections.mcpTools
    case CollectionType.workflow:
      return collections.workflowTools
    case CollectionType.builtIn:
    default:
      return collections.buildInTools
  }
}

const getCollectionsToSearch = (
  providerType: CollectionType | undefined,
  collections: ToolCollections,
) => {
  return [
    getPrimaryToolCollection(providerType, collections),
    collections.buildInTools,
    collections.customTools,
    collections.workflowTools,
    collections.mcpTools,
  ] as Array<ToolWithProvider[] | undefined>
}

const findToolInCollections = (
  collections: Array<ToolWithProvider[] | undefined>,
  data: ToolNodeType,
) => {
  const seen = new Set<ToolWithProvider[]>()

  for (const collection of collections) {
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

    if (matched)
      return matched
  }

  return undefined
}

const findToolNodeIcon = ({
  data,
  collections,
  theme,
}: {
  data: ToolNodeType
  collections: ToolCollections
  theme?: string
}) => {
  const matched = findToolInCollections(getCollectionsToSearch(data.provider_type, collections), data)
  if (matched) {
    const matchedIcon = resolveIconByTheme(theme, matched.icon, matched.icon_dark)
    if (matchedIcon)
      return matchedIcon
  }

  return resolveIconByTheme(theme, data.provider_icon, data.provider_icon_dark)
}

const findDataSourceIcon = (
  data: DataSourceNodeType,
  dataSourceList?: ToolWithProvider[],
) => {
  return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
}

const findNodeIcon = ({
  data,
  collections,
  dataSourceList,
  triggerPlugins,
  theme,
}: {
  data?: Node['data']
  collections: ToolCollections
  dataSourceList?: ToolWithProvider[]
  triggerPlugins?: TriggerWithProvider[]
  theme?: string
}) => {
  if (!data)
    return undefined

  if (isTriggerPluginNode(data)) {
    return findTriggerPluginIcon(
      [data.plugin_id, data.provider_id, data.provider_name],
      triggerPlugins,
      theme,
    )
  }

  if (isToolNode(data))
    return findToolNodeIcon({ data, collections, theme })

  if (isDataSourceNode(data))
    return findDataSourceIcon(data, dataSourceList)

  return undefined
}

export const useToolIcon = (data?: Node['data']) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const { theme } = useTheme()

  const toolIcon = useMemo(() => {
    return findNodeIcon({
      data,
      collections: {
        buildInTools,
        customTools,
        workflowTools,
        mcpTools,
      },
      dataSourceList,
      triggerPlugins,
      theme,
    }) || ''
  }, [data, dataSourceList, buildInTools, customTools, workflowTools, mcpTools, triggerPlugins, theme])

  return toolIcon
}

export const useGetToolIcon = () => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const { data: triggerPlugins } = useAllTriggerPlugins()
  const workflowStore = useWorkflowStore()
  const { theme } = useTheme()

  const getToolIcon = useCallback((data: Node['data']) => {
    const {
      buildInTools: storeBuiltInTools,
      customTools: storeCustomTools,
      workflowTools: storeWorkflowTools,
      mcpTools: storeMcpTools,
      dataSourceList,
    } = workflowStore.getState()

    return findNodeIcon({
      data,
      collections: {
        buildInTools: storeBuiltInTools ?? buildInTools,
        customTools: storeCustomTools ?? customTools,
        workflowTools: storeWorkflowTools ?? workflowTools,
        mcpTools: storeMcpTools ?? mcpTools,
      },
      dataSourceList,
      triggerPlugins,
      theme,
    })
  }, [workflowStore, triggerPlugins, buildInTools, customTools, workflowTools, mcpTools, theme])

  return getToolIcon
}
