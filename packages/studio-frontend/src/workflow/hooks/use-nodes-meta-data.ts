import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store'
import type { Node } from '@/app/components/workflow/types'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { useGetLanguage } from '@/context/i18n'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { canFindTool } from '@/utils'

export const useNodesMetaData = () => {
  const availableNodesMetaData = useHooksStore(s => s.availableNodesMetaData)

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData?.nodes || [],
      nodesMap: availableNodesMetaData?.nodesMap || {},
    } as AvailableNodesMetaData
  }, [availableNodesMetaData])
}

export const useNodeMetaData = (node: Node) => {
  const language = useGetLanguage()
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  const availableNodesMetaData = useNodesMetaData()
  const { data } = node
  const nodeMetaData = availableNodesMetaData.nodesMap?.[data.type]
  const author = useMemo(() => {
    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(dataSource => dataSource.plugin_id === data.plugin_id)?.author

    if (data.type === BlockEnum.Tool) {
      if (data.provider_type === CollectionType.builtIn)
        return buildInTools?.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.author
      if (data.provider_type === CollectionType.workflow)
        return workflowTools?.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author
      return customTools?.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.author
    }
    return nodeMetaData?.metaData.author
  }, [data, buildInTools, customTools, workflowTools, nodeMetaData, dataSourceList])

  const description = useMemo(() => {
    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(dataSource => dataSource.plugin_id === data.plugin_id)?.description[language]
    if (data.type === BlockEnum.Tool) {
      if (data.provider_type === CollectionType.builtIn)
        return buildInTools?.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.description[language]
      if (data.provider_type === CollectionType.workflow)
        return workflowTools?.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]
      return customTools?.find(toolWithProvider => toolWithProvider.id === data.provider_id)?.description[language]
    }
    return nodeMetaData?.metaData.description
  }, [data, buildInTools, customTools, workflowTools, nodeMetaData, dataSourceList, language])

  return useMemo(() => {
    return {
      ...nodeMetaData?.metaData,
      author,
      description,
    }
  }, [author, nodeMetaData, description])
}
