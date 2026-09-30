import type { UnsupportedNode } from '@dify/contracts/enterprise-app-deploy/types.gen'
import type { Node } from '@/app/components/workflow/types'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'
import { findNodeIcon } from '@/app/components/workflow/hooks/use-tool-icon'
import { BlockEnum } from '@/app/components/workflow/types'
import useTheme from '@/hooks/use-theme'
import { consoleQuery } from '@/service/console'
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'
import { useAllTriggerPlugins } from '@/service/use-triggers'

const PROVIDER_ICON_BLOCK_TYPES = new Set<string>([
  BlockEnum.DataSource,
  BlockEnum.Tool,
  BlockEnum.TriggerPlugin,
])

const toNodeData = (node: UnsupportedNode): Node['data'] | undefined => {
  if (!PROVIDER_ICON_BLOCK_TYPES.has(node.type) || !node.provider) return undefined

  return {
    desc: '',
    title: node.title,
    type: node.type,
    ...node.provider,
  } as Node['data']
}

export const useGetProviderIcon = (nodes: UnsupportedNode[]) => {
  const hasToolNode = nodes.some((node) => node.type === BlockEnum.Tool)
  const hasDataSourceNode = nodes.some((node) => node.type === BlockEnum.DataSource)
  const hasTriggerPluginNode = nodes.some((node) => node.type === BlockEnum.TriggerPlugin)
  const { data: buildInTools } = useAllBuiltInTools(hasToolNode)
  const { data: customTools } = useAllCustomTools(hasToolNode)
  const { data: workflowTools } = useAllWorkflowTools(hasToolNode)
  const { data: mcpTools } = useAllMCPTools(hasToolNode)
  const { data: dataSourceList } = useQuery(
    consoleQuery.rag.pipelines.datasourcePlugins.get.queryOptions({
      enabled: hasDataSourceNode,
    }),
  )
  const { data: triggerPlugins } = useAllTriggerPlugins(hasTriggerPluginNode)
  const { theme } = useTheme()

  return useCallback(
    (node: UnsupportedNode) => {
      const data = toNodeData(node)
      if (!data) return undefined

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
      })
    },
    [buildInTools, customTools, dataSourceList, mcpTools, theme, triggerPlugins, workflowTools],
  )
}
