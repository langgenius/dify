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
import { useStore } from '../store'
import { BlockEnum } from '../types'
import { matchDataSource, matchToolInCollection, matchTriggerProvider } from '../utils/plugin-install-check'

export type InstallationState = {
  isChecking: boolean
  isMissing: boolean
  uniqueIdentifier?: string
  canInstall: boolean
  onInstallSuccess: () => void
  shouldDim: boolean
}

const NOOP_INSTALLATION: InstallationState = {
  isChecking: false,
  isMissing: false,
  uniqueIdentifier: undefined,
  canInstall: false,
  onInstallSuccess: () => undefined,
  shouldDim: false,
}

const useToolInstallation = (data: ToolNodeType, enabled: boolean): InstallationState => {
  const isBuiltIn = enabled && data.provider_type === CollectionType.builtIn
  const isCustom = enabled && data.provider_type === CollectionType.custom
  const isWorkflow = enabled && data.provider_type === CollectionType.workflow
  const isMcp = enabled && data.provider_type === CollectionType.mcp

  const builtInQuery = useAllBuiltInTools(isBuiltIn)
  const customQuery = useAllCustomTools(isCustom)
  const workflowQuery = useAllWorkflowTools(isWorkflow)
  const mcpQuery = useAllMCPTools(isMcp)
  const invalidateTools = useInvalidToolsByType(enabled ? data.provider_type : undefined)

  const collectionInfo = useMemo(() => {
    if (!enabled)
      return undefined
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
    enabled,
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

  const { plugin_id, provider_id, provider_name } = data
  const matchedCollection = useMemo(() => {
    if (!collection || !collection.length)
      return undefined
    return matchToolInCollection(collection, { plugin_id, provider_id, provider_name })
  }, [collection, plugin_id, provider_id, provider_name])

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

const useTriggerInstallation = (data: PluginTriggerNodeType, enabled: boolean): InstallationState => {
  const triggerPluginsQuery = useAllTriggerPlugins(enabled)
  const invalidateTriggers = useInvalidateAllTriggerPlugins()

  const triggerProviders = triggerPluginsQuery.data
  const isLoading = triggerPluginsQuery.isLoading

  const { plugin_id, provider_id, provider_name } = data
  const matchedProvider = useMemo(() => {
    if (!triggerProviders || !triggerProviders.length)
      return undefined
    return matchTriggerProvider(triggerProviders, { plugin_id, provider_id, provider_name })
  }, [plugin_id, provider_id, provider_name, triggerProviders])

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

const useDataSourceInstallation = (data: DataSourceNodeType, _enabled: boolean): InstallationState => {
  const dataSourceList = useStore(s => s.dataSourceList)
  const invalidateDataSourceList = useInvalidDataSourceList()

  const { plugin_unique_identifier, plugin_id, provider_name } = data
  const matchedPlugin = useMemo(() => {
    if (!dataSourceList || !dataSourceList.length)
      return undefined
    return matchDataSource(dataSourceList, { plugin_unique_identifier, plugin_id, provider_name })
  }, [dataSourceList, plugin_id, plugin_unique_identifier, provider_name])

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
  const isTool = data.type === BlockEnum.Tool
  const isTrigger = data.type === BlockEnum.TriggerPlugin
  const isDataSource = data.type === BlockEnum.DataSource

  const toolInstallation = useToolInstallation(data as ToolNodeType, isTool)
  const triggerInstallation = useTriggerInstallation(data as PluginTriggerNodeType, isTrigger)
  const dataSourceInstallation = useDataSourceInstallation(data as DataSourceNodeType, isDataSource)

  if (isTool)
    return toolInstallation
  if (isTrigger)
    return triggerInstallation
  if (isDataSource)
    return dataSourceInstallation
  return NOOP_INSTALLATION
}
