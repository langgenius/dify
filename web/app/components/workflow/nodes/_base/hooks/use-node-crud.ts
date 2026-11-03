import type { CommonNodeType } from '@/app/components/workflow/types'
import { useCallback, useEffect, useRef } from 'react'
import { useNodeDataUpdate } from '../../../hooks/use-node-data-update'

const useNodeCrud = <T>(
  id: string,
  data: CommonNodeType<T>,
  { replace = true }: { replace?: boolean } = {},
) => {
  const { handleNodeDataUpdateWithSyncDraft } = useNodeDataUpdate()
  const updateRef = useRef(handleNodeDataUpdateWithSyncDraft)

  useEffect(() => {
    updateRef.current = handleNodeDataUpdateWithSyncDraft
  }, [handleNodeDataUpdateWithSyncDraft])

  const setInputs = useCallback(
    (newInputs: CommonNodeType<T>) => {
      updateRef.current({
        id,
        data: newInputs,
        replace,
      })
    },
    [id, replace],
  )

  return {
    inputs: data,
    setInputs,
  }
}

export default useNodeCrud
