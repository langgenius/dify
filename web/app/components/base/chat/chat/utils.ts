import type { InputForm } from './type'
import { InputVarType } from '@/app/components/workflow/types'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'

export const processOpeningStatement = (openingStatement: string, inputs: Record<string, any>, inputsForm: InputForm[]) => {
  if (!openingStatement)
    return openingStatement

  return openingStatement.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name) { // has set value
      return name
    }

    const valueObj = inputsForm.find(v => v.variable === key)
    return valueObj ? `{{${valueObj.label}}}` : match
  })
}

export const getProcessedInputs = (inputs: Record<string, any>, inputsForm: InputForm[]) => {
  const processedInputs = { ...inputs }

  inputsForm.forEach((item) => {
    if (item.type === InputVarType.multiFiles && inputs[item.variable])
      processedInputs[item.variable] = getProcessedFiles(inputs[item.variable])

    if (item.type === InputVarType.singleFile && inputs[item.variable])
      processedInputs[item.variable] = getProcessedFiles([inputs[item.variable]])[0]
  })

  return processedInputs
}
