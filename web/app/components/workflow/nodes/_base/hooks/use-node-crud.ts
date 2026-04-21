import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useEffect, useRef } from 'react'
import { useNodeDataUpdate } from '@/app/components/workflow/hooks'

const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const updateRef = useRef(handleNodeDataUpdateWithSyncDraft)

  useEffect(() => {
    updateRef.current = handleNodeDataUpdateWithSyncDraft
  }, [handleNodeDataUpdateWithSyncDraft])

  const setInputs = useCallback((newInputs: CommonNodeType<T>) => {
    updateRef.current({
      id,
      data: newInputs,
    })
  }, [id])

  return {
    inputs: data,
    setInputs,
  }
}

export default useNodeCrud
