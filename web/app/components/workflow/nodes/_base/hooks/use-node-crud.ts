import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'
import type { CommonNodeType } from '@/app/components/workflow/types'
const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const setInputs = (newInputs: CommonNodeType<T>) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data: newInputs,
    })
  }

  return {
    inputs: data,
    setInputs,
  }
}

export const useNodeUpdate = (id: string) => {
  const store = useStoreApi()
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()

  const getNodeData = useCallback(() => {
    const { getNodes } = store.getState()
    const nodes = getNodes()

    return nodes.find(node => node.id === id)
  }, [store, id])

  const handleNodeDataUpdate = useCallback((data: any) => {
    handleNodeDataUpdateWithSyncDraft({
      id,
      data,
    })
  }, [id, handleNodeDataUpdateWithSyncDraft])

  return {
    getNodeData,
    handleNodeDataUpdate,
  }
}

export default useNodeCrud
