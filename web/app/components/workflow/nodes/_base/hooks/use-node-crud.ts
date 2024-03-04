import { useWorkflow } from '@/app/components/workflow/hooks'
import type { CommonNodeType } from '@/app/components/workflow/types'
const useNodeCrud = <T>(id: string, data: CommonNodeType<T>) => {
  const { handleNodeDataUpdate } = useWorkflow()

  const setInputs = (newInputs: CommonNodeType<T>) => {
    handleNodeDataUpdate({
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
