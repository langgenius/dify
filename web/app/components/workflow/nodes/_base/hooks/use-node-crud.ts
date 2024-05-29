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

export default useNodeCrud
