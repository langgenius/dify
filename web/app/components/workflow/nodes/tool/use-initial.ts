import {
  useCallback,
  useEffect,
} from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks/use-node-data-update'
import { useLanguage } from '@/app/components/header/account-setting/model-provider-page/hooks'
import { useStore } from '../../store'
import type { ToolNodeType } from './types'
import { canFindTool } from '@/utils'

export const useInitial = (id: string) => {
  const store = useStoreApi()
  const buildInTools = useStore(s => s.buildInTools)
  const language = useLanguage()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === id)
  }, [store, id])

  const handleNodeDataUpdate = useCallback((data: Partial<ToolNodeType>) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data,
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

  const handleInitial = useCallback(() => {
    const nodeData = getNodeData()
    const { provider_id, tool_name, _notInitialized } = nodeData?.data || {}
    const currCollection = buildInTools.find(item => canFindTool(item.id, provider_id))
    const currTool = currCollection?.tools.find(tool => tool.name === tool_name)

    if (!currTool)
      return

    if (_notInitialized && currCollection) {
      const params: Record<string, string> = {}
      if (currTool.parameters) {
        currTool.parameters.forEach((item) => {
          params[item.name] = ''
        })
      }
      handleNodeDataUpdate({
        provider_id: currCollection.id,
        provider_type: currCollection.type as any,
        provider_name: currCollection.name,
        tool_name: currTool.name,
        tool_label: currTool.label[language],
        tool_description: currTool.description[language],
        title: currTool.label[language],
        is_team_authorization: currCollection.is_team_authorization,
        output_schema: currTool.output_schema,
        paramSchemas: currTool.parameters,
        params,
        _notInitialized: false,
      })
    }
  }, [handleNodeDataUpdate, language, buildInTools, getNodeData])

  useEffect(() => {
    handleInitial()
  }, [handleInitial])
}
