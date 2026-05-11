import type { InputForm } from './type'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { InputVarType } from '@/app/components/workflow/types'

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

export const processInputFileFromServer = (fileItem: Record<string, any>) => {
  return {
    type: fileItem.type,
    transfer_method: fileItem.transfer_method,
    url: fileItem.remote_url,
    upload_file_id: fileItem.related_id,
  }
}

export const getProcessedInputs = (inputs: Record<string, any>, inputsForm: InputForm[]) => {
  const processedInputs = { ...inputs }

  inputsForm.forEach((item) => {
    const inputValue = inputs[item.variable]
    // set boolean type default value
    if (item.type === InputVarType.checkbox) {
      processedInputs[item.variable] = !!inputValue
      return
    }

    if (inputValue == null)
      return

    if (item.type === InputVarType.singleFile) {
      if ('transfer_method' in inputValue)
        processedInputs[item.variable] = processInputFileFromServer(inputValue)
      else
        processedInputs[item.variable] = getProcessedFiles([inputValue])[0]
    }
    else if (item.type === InputVarType.multiFiles) {
      if ('transfer_method' in inputValue[0])
        processedInputs[item.variable] = inputValue.map(processInputFileFromServer)
      else
        processedInputs[item.variable] = getProcessedFiles(inputValue)
    }
    else if (item.type === InputVarType.jsonObject) {
      // Prefer sending an object if the user entered valid JSON; otherwise keep the raw string.
      try {
        const v = typeof inputValue === 'string' ? JSON.parse(inputValue) : inputValue
        if (v && typeof v === 'object' && !Array.isArray(v))
          processedInputs[item.variable] = v
        else
          processedInputs[item.variable] = inputValue
      }
      catch {
        // keep original string; backend will parse/validate
        processedInputs[item.variable] = inputValue
      }
    }
  })

  return processedInputs
}
