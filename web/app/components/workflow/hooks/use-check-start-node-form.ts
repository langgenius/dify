import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useStoreApi } from 'reactflow'
import { useWorkflowStore } from '@/app/components/workflow/store'
import {
  BlockEnum,
  InputVarType,
} from '@/app/components/workflow/types'
import { useToastContext } from '@/app/components/base/toast'
import type { InputVar } from '@/app/components/workflow/types'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'

export const useCheckStartNodeForm = () => {
  const { t } = useTranslation()
  const storeApi = useStoreApi()
  const workflowStore = useWorkflowStore()
  const { notify } = useToastContext()

  const checkStartNodeForm = useCallback(() => {
    const { getNodes } = storeApi.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const variables: InputVar[] = startNode?.data.variables || []
    const inputs = workflowStore.getState().inputs

    let hasEmptyInput = ''
    const requiredVars = variables.filter(({ required }) => required)

    if (requiredVars?.length) {
      requiredVars.forEach(({ variable, label }) => {
        if (hasEmptyInput)
          return

        if (!inputs[variable])
          hasEmptyInput = label as string
      })
    }

    if (hasEmptyInput) {
      notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }) })
      return false
    }

    return true
  }, [storeApi, workflowStore, notify, t])

  const getProcessedInputs = useCallback((inputs: Record<string, any>) => {
    const { getNodes } = storeApi.getState()
    const nodes = getNodes()
    const startNode = nodes.find(node => node.data.type === BlockEnum.Start)
    const variables: InputVar[] = startNode?.data.variables || []

    const processedInputs = { ...inputs }

    variables.forEach((variable) => {
      if (variable.type === InputVarType.multiFiles)
        processedInputs[variable.variable] = getProcessedFiles(inputs[variable.variable])

      if (variable.type === InputVarType.singleFile)
        processedInputs[variable.variable] = getProcessedFiles([inputs[variable.variable]])[0]
    })

    return processedInputs
  }, [storeApi])

  return {
    checkStartNodeForm,
    getProcessedInputs,
  }
}
