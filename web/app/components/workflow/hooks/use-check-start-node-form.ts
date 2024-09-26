import { useCallback } from 'react'
import { useStoreApi } from 'reactflow'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import type { InputVar } from '@/app/components/workflow/types'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'

export const useCheckStartNodeForm = () => {
  const storeApi = useStoreApi()

  const getProcessedInputs = useCallback((inputs: Record<string, any>) => {
    const { getNodes } = storeApi.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const variables: InputVar[] = startNode?.data.variables || []

    const processedInputs = { ...inputs }

    variables.forEach((variable) => {
      if (variable.type === InputVarType.multiFiles && inputs[variable.variable])
        processedInputs[variable.variable] = getProcessedFiles(inputs[variable.variable])

      if (variable.type === InputVarType.singleFile && inputs[variable.variable])
        processedInputs[variable.variable] = getProcessedFiles([inputs[variable.variable]])[0]
    })

    return processedInputs
  }, [storeApi])

  return {
    getProcessedInputs,
  }
}
