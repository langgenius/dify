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
import {
  useAllBuiltInTools,
  useAllCustomTools,
  useAllMCPTools,
  useAllWorkflowTools,
} from '@/service/use-tools'

export const useToolIcon = (data?: Node['data']) => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const { data: mcpTools } = useAllMCPTools()
  const dataSourceList = useStore(s => s.dataSourceList)
  // const a = useStore(s => s.data)
  const toolIcon = useMemo(() => {
    if (!data)
      return ''
    if (data.type === BlockEnum.Tool) {
      // eslint-disable-next-line sonarjs/no-dead-store
      let targetTools = buildInTools || []
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools || []
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools || []
      else if (data.provider_type === CollectionType.mcp)
        targetTools = mcpTools || []
      else
        targetTools = workflowTools || []
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }
    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [data, dataSourceList, buildInTools, customTools, mcpTools, workflowTools])

  return toolIcon
}

export const useGetToolIcon = () => {
  const { data: buildInTools } = useAllBuiltInTools()
  const { data: customTools } = useAllCustomTools()
  const { data: workflowTools } = useAllWorkflowTools()
  const workflowStore = useWorkflowStore()
  const getToolIcon = useCallback((data: Node['data']) => {
    const {
      dataSourceList,
    } = workflowStore.getState()

    if (data.type === BlockEnum.Tool) {
      // eslint-disable-next-line sonarjs/no-dead-store
      let targetTools = buildInTools || []
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools || []
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools || []
      else
        targetTools = workflowTools || []
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }

    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [workflowStore])

  return getToolIcon
}
