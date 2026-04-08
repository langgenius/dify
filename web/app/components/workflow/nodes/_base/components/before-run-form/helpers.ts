import type { Props as FormProps } from './form'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { InputVarType } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'

export function formatValue(value: unknown, type: InputVarType) {
  if (type === InputVarType.checkbox)
    return !!value
  if (value === undefined || value === null)
    return value
  if (type === InputVarType.number)
    return Number.parseFloat(String(value))
  if (type === InputVarType.json)
    return JSON.parse(String(value))
  if (type === InputVarType.contexts)
    return (value as string[]).map(item => JSON.parse(item))
  if (type === InputVarType.multiFiles)
    return getProcessedFiles(value as FileEntity[])

  if (type === InputVarType.singleFile) {
    if (Array.isArray(value))
      return getProcessedFiles(value as FileEntity[])
    if (!value)
      return undefined
    return getProcessedFiles([value as FileEntity])[0]
  }

  return value
}

export const isFilesLoaded = (forms: FormProps[]) => {
  if (!forms.length)
    return true

  const filesForm = forms.find(item => !!item.values['#files#'])
  if (!filesForm)
    return true

  const files = filesForm.values['#files#'] as unknown as Array<{ transfer_method?: TransferMethod, upload_file_id?: string }> | undefined
  return !files?.some(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)
}

export const getFormErrorMessage = (
  forms: FormProps[],
  existVarValuesInForms: Record<string, unknown>[],
  t: (key: string, options?: Record<string, unknown>) => string,
) => {
  let errMsg = ''

  forms.forEach((form, index) => {
    const existVarValuesInForm = existVarValuesInForms[index]

    form.inputs.forEach((input) => {
      const value = form.values[input.variable] as unknown
      const missingRequired = input.required
        && input.type !== InputVarType.checkbox
        && !(input.variable in existVarValuesInForm)
        && (
          value === '' || value === undefined || value === null
          || (
            (input.type === InputVarType.files
              || input.type === InputVarType.multiFiles
              || input.type === InputVarType.singleFile)
            && Array.isArray(value)
            && value.length === 0
          )
        )

      if (!errMsg && missingRequired) {
        errMsg = t('errorMsg.fieldRequired', { ns: 'workflow', field: typeof input.label === 'object' ? input.label.variable : input.label })
        return
      }

      if (!errMsg && (input.type === InputVarType.singleFile || input.type === InputVarType.multiFiles) && value) {
        const fileIsUploading = Array.isArray(value)
          ? value.find((item: { transferMethod?: TransferMethod, uploadedId?: string }) => item.transferMethod === TransferMethod.local_file && !item.uploadedId)
          : (value as { transferMethod?: TransferMethod, uploadedId?: string }).transferMethod === TransferMethod.local_file
            && !(value as { transferMethod?: TransferMethod, uploadedId?: string }).uploadedId

        if (fileIsUploading)
          errMsg = t('errorMessage.waitForFileUpload', { ns: 'appDebug' })
      }
    })
  })

  return errMsg
}

export const buildSubmitData = (forms: FormProps[]) => {
  const submitData: Record<string, unknown> = {}
  let parseErrorJsonField = ''

  forms.forEach((form) => {
    form.inputs.forEach((input) => {
      try {
        submitData[input.variable] = formatValue(form.values[input.variable], input.type)
      }
      catch {
        parseErrorJsonField = input.variable
      }
    })
  })

  return { submitData, parseErrorJsonField }
}

export const shouldAutoRunBeforeRunForm = (filteredExistVarForms: FormProps[], isHumanInput: boolean) => {
  return filteredExistVarForms.length === 0 && !isHumanInput
}

export const shouldAutoShowGeneratedForm = (filteredExistVarForms: FormProps[], isHumanInput: boolean) => {
  return filteredExistVarForms.length === 0 && isHumanInput
}
