import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useEffect, useRef } from 'react'
import { useNodeDataUpdate } from '../../../hooks/use-node-data-update'
import { useStore } from '../../../store'

const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const hasLoroDraft = useStore((s) => !!s.loroDraft)
  const updateRef = useRef(handleNodeDataUpdateWithSyncDraft)
  useEffect(() => {
    updateRef.current = handleNodeDataUpdateWithSyncDraft
  }, [handleNodeDataUpdateWithSyncDraft])

  const setLocalInputs = useCallback(
    (newInputs: CommonNodeType<T>) => updateRef.current({ id, data: newInputs }),
    [id],
  )
  const setDraftInputs = useCallback(
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
    setInputs: hasLoroDraft ? setDraftInputs : setLocalInputs,
  }
}

export default useNodeCrud
