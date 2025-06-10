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

export const useToolIcon = (data: Node['data']) => {
  const buildInTools = useStore(s => s.buildInTools)
  const customTools = useStore(s => s.customTools)
  const workflowTools = useStore(s => s.workflowTools)
  const dataSourceList = useStore(s => s.dataSourceList)
  // const a = useStore(s => s.data)
  const toolIcon = useMemo(() => {
    if (data.type === BlockEnum.Tool) {
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }
    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [data, buildInTools, customTools, workflowTools, dataSourceList])

  return toolIcon
}

export const useGetToolIcon = () => {
  const workflowStore = useWorkflowStore()
  const getToolIcon = useCallback((data: Node['data']) => {
    const {
      buildInTools,
      customTools,
      workflowTools,
      dataSourceList,
    } = workflowStore.getState()

    if (data.type === BlockEnum.Tool) {
      let targetTools = buildInTools
      if (data.provider_type === CollectionType.builtIn)
        targetTools = buildInTools
      else if (data.provider_type === CollectionType.custom)
        targetTools = customTools
      else
        targetTools = workflowTools
      return targetTools.find(toolWithProvider => canFindTool(toolWithProvider.id, data.provider_id))?.icon
    }

    if (data.type === BlockEnum.DataSource)
      return dataSourceList?.find(toolWithProvider => toolWithProvider.plugin_id === data.plugin_id)?.icon
  }, [workflowStore])

  return getToolIcon
}
