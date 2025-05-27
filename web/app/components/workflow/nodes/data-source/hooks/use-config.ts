import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { InputVar } from '@/models/pipeline'
import type { DataSourceNodeType } from '../types'

export const useConfig = (id: string) => {
  const store = useStoreApi()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === id)
  }, [store, id])

  const handleNodeDataUpdate = useCallback((data: Partial<DataSourceNodeType>) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data,
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])
  const handleFileExtensionsChange = useCallback((fileExtensions: string[]) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      ...nodeData?.data,
      fileExtensions,
    })
  }, [handleNodeDataUpdate, getNodeData])

  const handleInputFieldVariablesChange = useCallback((variables: InputVar[]) => {
    const nodeData = getNodeData()
    handleNodeDataUpdate({
      ...nodeData?.data,
      variables,
    })
  }, [handleNodeDataUpdate, getNodeData])

  return {
    handleFileExtensionsChange,
    handleInputFieldVariablesChange,
  }
}
