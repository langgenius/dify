import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { InputForm } from './type'
import { useToastContext } from '@/app/components/base/toast'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

export const useCheckInputsForms = () => {
  const { t } = useTranslation()
  const { notify } = useToastContext()

  const checkInputsForm = useCallback((inputs: Record<string, any>, inputsForm: InputForm[]) => {
    let hasEmptyInput = ''
    let fileIsUploading = false
    const requiredVars = inputsForm.filter(({ required, type }) => required && type !== InputVarType.checkbox) // boolean can be not checked

    if (requiredVars?.length) {
      requiredVars.forEach(({ variable, label, type }) => {
        if (hasEmptyInput)
          return

        if (fileIsUploading)
          return

        if (!inputs[variable])
          hasEmptyInput = label as string

        if ((type === InputVarType.singleFile || type === InputVarType.multiFiles) && inputs[variable]) {
          const files = inputs[variable]
          if (Array.isArray(files))
            fileIsUploading = files.find(item => item.transferMethod === TransferMethod.local_file && !item.uploadedId)
          else
            fileIsUploading = files.transferMethod === TransferMethod.local_file && !files.uploadedId
        }
      })
    }

    if (hasEmptyInput) {
      notify({ type: 'error', message: t('appDebug.errorMessage.valueOfVarRequired', { key: hasEmptyInput }) })
      return false
    }

    if (fileIsUploading) {
      notify({ type: 'info', message: t('appDebug.errorMessage.waitForFileUpload') })
      return
    }

    return true
  }, [notify, t])

  return {
    checkInputsForm,
  }
}
