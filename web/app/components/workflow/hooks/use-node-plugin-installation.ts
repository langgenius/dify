import type { DataSourceNodeType } from '../nodes/data-source/types'
import type { ToolNodeType } from '../nodes/tool/types'
import type { PluginTriggerNodeType } from '../nodes/trigger-plugin/types'
import type { CommonNodeType } from '../types'
import { useCallback, useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { useInvalidDataSourceList } from '@/service/use-pipeline'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
  useInvalidToolsByType,
} from '@/service/use-tools'
import {
  useAllTriggerPlugins,
  useInvalidateAllTriggerPlugins,
} from '@/service/use-triggers'
import { canFindTool } from '@/utils'
import { useStore } from '../store'
import { BlockEnum } from '../types'

type InstallationState = {
  isChecking: boolean
  isMissing: boolean
  uniqueIdentifier?: string
  canInstall: boolean
  onInstallSuccess: () => void
  shouldDim: boolean
}

const useToolInstallation = (data: ToolNodeType): InstallationState => {
  const builtInQuery = useAllBuiltInTools()
  const customQuery = useAllCustomTools()
  const workflowQuery = useAllWorkflowTools()
  const mcpQuery = useAllMCPTools()
  const invalidateTools = useInvalidToolsByType(data.provider_type)

  const collectionInfo = useMemo(() => {
    switch (data.provider_type) {
      case CollectionType.builtIn:
        return {
          list: builtInQuery.data,
          isLoading: builtInQuery.isLoading,
        }
      case CollectionType.custom:
        return {
          list: customQuery.data,
          isLoading: customQuery.isLoading,
        }
      case CollectionType.workflow:
        return {
          list: workflowQuery.data,
          isLoading: workflowQuery.isLoading,
        }
      case CollectionType.mcp:
        return {
          list: mcpQuery.data,
          isLoading: mcpQuery.isLoading,
        }
      default:
        return undefined
    }
  }, [
    builtInQuery.data,
    builtInQuery.isLoading,
    customQuery.data,
    customQuery.isLoading,
    data.provider_type,
    mcpQuery.data,
    mcpQuery.isLoading,
    workflowQuery.data,
    workflowQuery.isLoading,
  ])

  const collection = collectionInfo?.list
  const isLoading = collectionInfo?.isLoading ?? false
  const isResolved = !!collectionInfo && !isLoading

  const matchedCollection = useMemo(() => {
    if (!collection || !collection.length)
      return undefined

    return collection.find((toolWithProvider) => {
      if (data.plugin_id && toolWithProvider.plugin_id === data.plugin_id)
        return true
      if (canFindTool(toolWithProvider.id, data.provider_id))
        return true
      if (toolWithProvider.name === data.provider_name)
        return true
      return false
    })
  }, [collection, data.plugin_id, data.provider_id, data.provider_name])

  const uniqueIdentifier = data.plugin_unique_identifier || data.plugin_id || data.provider_id
  const canInstall = Boolean(data.plugin_unique_identifier)

  const onInstallSuccess = useCallback(() => {
    if (invalidateTools)
      invalidateTools()
  }, [invalidateTools])

  const shouldDim = (!!collectionInfo && !isResolved) || (isResolved && !matchedCollection)

  return {
    isChecking: !!collectionInfo && !isResolved,
    isMissing: isResolved && !matchedCollection,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  }
}

const useTriggerInstallation = (data: PluginTriggerNodeType): InstallationState => {
  const triggerPluginsQuery = useAllTriggerPlugins()
  const invalidateTriggers = useInvalidateAllTriggerPlugins()

  const triggerProviders = triggerPluginsQuery.data
  const isLoading = triggerPluginsQuery.isLoading

  const matchedProvider = useMemo(() => {
    if (!triggerProviders || !triggerProviders.length)
      return undefined

    return triggerProviders.find(provider =>
      provider.name === data.provider_name
      || provider.id === data.provider_id
      || (data.plugin_id && provider.plugin_id === data.plugin_id),
    )
  }, [
    data.plugin_id,
    data.provider_id,
    data.provider_name,
    triggerProviders,
  ])

  const uniqueIdentifier = data.plugin_unique_identifier || data.plugin_id || data.provider_id
  const canInstall = Boolean(data.plugin_unique_identifier)

  const onInstallSuccess = useCallback(() => {
    invalidateTriggers()
  }, [invalidateTriggers])

  const shouldDim = isLoading || (!isLoading && !!triggerProviders && !matchedProvider)

  return {
    isChecking: isLoading,
    isMissing: !isLoading && !!triggerProviders && !matchedProvider,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  }
}

const useDataSourceInstallation = (data: DataSourceNodeType): InstallationState => {
  const dataSourceList = useStore(s => s.dataSourceList)
  const invalidateDataSourceList = useInvalidDataSourceList()

  const matchedPlugin = useMemo(() => {
    if (!dataSourceList || !dataSourceList.length)
      return undefined

    return dataSourceList.find((item) => {
      if (data.plugin_unique_identifier && item.plugin_unique_identifier === data.plugin_unique_identifier)
        return true
      if (data.plugin_id && item.plugin_id === data.plugin_id)
        return true
      if (data.provider_name && item.provider === data.provider_name)
        return true
      return false
    })
  }, [data.plugin_id, data.plugin_unique_identifier, data.provider_name, dataSourceList])

  const uniqueIdentifier = data.plugin_unique_identifier || data.plugin_id
  const canInstall = Boolean(data.plugin_unique_identifier)

  const onInstallSuccess = useCallback(() => {
    invalidateDataSourceList()
  }, [invalidateDataSourceList])

  const hasLoadedList = dataSourceList !== undefined

  const shouldDim = !hasLoadedList || (hasLoadedList && !matchedPlugin)

  return {
    isChecking: !hasLoadedList,
    isMissing: hasLoadedList && !matchedPlugin,
    uniqueIdentifier,
    canInstall,
    onInstallSuccess,
    shouldDim,
  }
}

export const useNodePluginInstallation = (data: CommonNodeType): InstallationState => {
  const toolInstallation = useToolInstallation(data as ToolNodeType)
  const triggerInstallation = useTriggerInstallation(data as PluginTriggerNodeType)
  const dataSourceInstallation = useDataSourceInstallation(data as DataSourceNodeType)

  switch (data.type as BlockEnum) {
    case BlockEnum.Tool:
      return toolInstallation
    case BlockEnum.TriggerPlugin:
      return triggerInstallation
    case BlockEnum.DataSource:
      return dataSourceInstallation
    default:
      return {
        isChecking: false,
        isMissing: false,
        uniqueIdentifier: undefined,
        canInstall: false,
        onInstallSuccess: () => undefined,
        shouldDim: false,
      }
  }
}
