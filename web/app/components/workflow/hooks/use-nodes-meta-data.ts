import type { AvailableNodesMetaData } from '@/app/components/workflow/hooks-store'
import type { Node } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { CollectionType } from '@/app/components/tools/types'
import { selectToolsWithProvider } from '@/app/components/tools/utils/query-select'
import { useHooksStore } from '@/app/components/workflow/hooks-store'
import { useStore } from '@/app/components/workflow/store'
import { BlockEnum } from '@/app/components/workflow/types'
import { getNodeCatalogType } from '@/app/components/workflow/utils/node'
import { useGetLanguage } from '@/context/i18n'
import { renderI18nObject } from '@/i18n/metadata'
import { consoleQuery } from '@/service/console'
import { matchesProviderReference } from '@/utils/provider-reference'
import { matchDataSource } from '../utils/plugin-install-check'

export const useNodesMetaData = () => {
  const availableNodesMetaData = useHooksStore((s) => s.availableNodesMetaData)

  return useMemo(() => {
    return {
      nodes: availableNodesMetaData?.nodes || [],
      nodesMap: availableNodesMetaData?.nodesMap || {},
    } as AvailableNodesMetaData
  }, [availableNodesMetaData])
}

export const useNodeMetaData = (node: Node) => {
  const language = useGetLanguage()
  const { data: buildInTools } = useQuery(
    consoleQuery.workspaces.current.tools.builtin.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const { data: customTools } = useQuery(
    consoleQuery.workspaces.current.tools.api.get.queryOptions({ select: selectToolsWithProvider }),
  )
  const { data: workflowTools } = useQuery(
    consoleQuery.workspaces.current.tools.workflow.get.queryOptions({
      select: selectToolsWithProvider,
    }),
  )
  const dataSourceList = useStore((s) => s.dataSourceList)
  const availableNodesMetaData = useNodesMetaData()
  const { data } = node
  const nodeMetaData = availableNodesMetaData.nodesMap?.[getNodeCatalogType(data)]
  const author = useMemo(() => {
    if (data.type === BlockEnum.DataSource)
      return matchDataSource(dataSourceList ?? [], data)?.declaration.identity.author

    if (data.type === BlockEnum.Tool) {
      if (data.provider_type === CollectionType.builtIn)
        return buildInTools?.find((toolWithProvider) =>
          matchesProviderReference(toolWithProvider, data.provider_id),
        )?.author
      if (data.provider_type === CollectionType.workflow)
        return workflowTools?.find((toolWithProvider) =>
          matchesProviderReference(toolWithProvider, data.provider_id),
        )?.author
      return customTools?.find((toolWithProvider) =>
        matchesProviderReference(toolWithProvider, data.provider_id),
      )?.author
    }
    return nodeMetaData?.metaData.author
  }, [data, buildInTools, customTools, workflowTools, nodeMetaData, dataSourceList])

  const description = useMemo(() => {
    if (data.type === BlockEnum.DataSource)
      return renderI18nObject(
        matchDataSource(dataSourceList ?? [], data)?.declaration.identity.description,
        language,
      )
    if (data.type === BlockEnum.Tool) {
      if (data.provider_type === CollectionType.builtIn)
        return buildInTools?.find((toolWithProvider) =>
          matchesProviderReference(toolWithProvider, data.provider_id),
        )?.description[language]
      if (data.provider_type === CollectionType.workflow)
        return workflowTools?.find((toolWithProvider) =>
          matchesProviderReference(toolWithProvider, data.provider_id),
        )?.description[language]
      return customTools?.find((toolWithProvider) =>
        matchesProviderReference(toolWithProvider, data.provider_id),
      )?.description[language]
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
