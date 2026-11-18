import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback } from 'react'
import { useNodeDataUpdate } from '../../../hooks/use-node-data-update'

const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const setInputs = useCallback(
    (newInputs: CommonNodeType<T>) => {
      handleNodeDataUpdateWithSyncDraft({
        id,
        previousData: data,
        data: newInputs,
      })
    },
    [id, data, handleNodeDataUpdateWithSyncDraft],
  )

  return {
    inputs: data,
    setInputs,
  }
}

export default useNodeCrud
