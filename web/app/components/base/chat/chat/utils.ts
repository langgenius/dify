import type { InputForm } from './type'
import type { FileEntity } from '@/app/components/base/file-uploader/types'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { InputVarType } from '@/app/components/workflow/types'

export const processOpeningStatement = (
  openingStatement: string,
  inputs: Record<string, unknown>,
  inputsForm: InputForm[],
) => {
  if (!openingStatement) return openingStatement

  return openingStatement.replace(/\{\{([^}]+)\}\}/g, (match, key) => {
    const name = inputs[key]
    if (name) {
      // has set value
      return String(name)
    }

    const valueObj = inputsForm.find((v) => v.variable === key)
    return valueObj ? `{{${valueObj.label}}}` : match
  })
}

export const processInputFileFromServer = (fileItem: Record<string, unknown>) => {
  return {
    type: fileItem.type,
    transfer_method: fileItem.transfer_method,
    url: fileItem.remote_url,
    upload_file_id: fileItem.related_id,
  }
}

const parseFileInputValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value

  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed
  } catch {
    // Keep raw string values for non-JSON file inputs.
  }

  return value
}

const isServerFileValue = (value: unknown): value is Record<string, unknown> => {
  const normalized = parseFileInputValue(value)

  return (
    normalized != null &&
    typeof normalized === 'object' &&
    !Array.isArray(normalized) &&
    'transfer_method' in normalized
  )
}

export const getProcessedInputs = (inputs: Record<string, unknown>, inputsForm: InputForm[]) => {
  const processedInputs = { ...inputs }

  inputsForm.forEach((item) => {
    const inputValue = inputs[item.variable]
    // set boolean type default value
    if (item.type === InputVarType.checkbox) {
      processedInputs[item.variable] = !!inputValue
      return
    }

    if (inputValue == null) return

    if (item.type === InputVarType.singleFile) {
      const normalizedValue = parseFileInputValue(inputValue)
      if (isServerFileValue(normalizedValue))
        processedInputs[item.variable] = processInputFileFromServer(normalizedValue)
      else if (normalizedValue != null)
        processedInputs[item.variable] = getProcessedFiles([normalizedValue as FileEntity])[0]
    } else if (item.type === InputVarType.multiFiles) {
      const fileValues = (Array.isArray(inputValue) ? inputValue : [inputValue]).filter(
        (value) => value != null,
      )
      if (fileValues.length === 0) return

      if (isServerFileValue(fileValues[0]))
        processedInputs[item.variable] = fileValues.map((value) => {
          const normalized = parseFileInputValue(value)
          return processInputFileFromServer(
            isServerFileValue(normalized) ? normalized : (value as Record<string, unknown>),
          )
        })
      else processedInputs[item.variable] = getProcessedFiles(fileValues as FileEntity[])
    } else if (item.type === InputVarType.jsonObject) {
      // Prefer sending an object if the user entered valid JSON; otherwise keep the raw string.
      try {
        const v = typeof inputValue === 'string' ? JSON.parse(inputValue) : inputValue
        if (v && typeof v === 'object' && !Array.isArray(v)) processedInputs[item.variable] = v
        else processedInputs[item.variable] = inputValue
      } catch {
        // keep original string; backend will parse/validate
        processedInputs[item.variable] = inputValue
      }
    }
  })

  return processedInputs
}
