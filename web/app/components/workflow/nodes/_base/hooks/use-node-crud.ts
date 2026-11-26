import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useLayoutEffect, useRef } from 'react'
import { useNodeDataUpdate } from '../../../hooks/use-node-data-update'

const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const dataRef = useRef(data)
  const updateRef = useRef(handleNodeDataUpdateWithSyncDraft)
  useLayoutEffect(() => {
    dataRef.current = data
    updateRef.current = handleNodeDataUpdateWithSyncDraft
  }, [data, handleNodeDataUpdateWithSyncDraft])

  const setInputs = useCallback(
    (newInputs: CommonNodeType<T>) => {
      if (updateRef.current({ id, previousData: dataRef.current, data: newInputs }))
        dataRef.current = newInputs
    },
    [id],
  )

  return {
    inputs: data,
    setInputs,
  }
}

export default useNodeCrud
