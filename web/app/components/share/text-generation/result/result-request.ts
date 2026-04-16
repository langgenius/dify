import type { FileEntity } from '@/app/components/base/file-uploader/types'
import type { PromptConfig } from '@/models/debug'
import type { VisionFile, VisionSettings } from '@/types/app'
import { getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { TransferMethod } from '@/types/app'
import { formatBooleanInputs } from '@/utils/model-config'

export type ResultInputValue
  = | string
    | boolean
    | number
    | string[]
    | Record<string, unknown>
    | FileEntity
    | FileEntity[]
    | undefined

type Translate = (key: string, options?: Record<string, unknown>) => string

type ValidationResult = {
  canSend: boolean
  notification?: {
    type: 'error' | 'info'
    message: string
  }
}

type ValidateResultRequestParams = {
  completionFiles: VisionFile[]
  inputs: Record<string, ResultInputValue>
  isCallBatchAPI: boolean
  promptConfig: PromptConfig | null
  t: Translate
}

type BuildResultRequestDataParams = {
  completionFiles: VisionFile[]
  inputs: Record<string, ResultInputValue>
  promptConfig: PromptConfig | null
  visionConfig: VisionSettings
}

const isMissingRequiredInput = (
  variable: PromptConfig['prompt_variables'][number],
  value: ResultInputValue,
) => {
  if (value === undefined || value === null)
    return true

  if (variable.type === 'file-list')
    return !Array.isArray(value) || value.length === 0

  if (['string', 'paragraph', 'number', 'json_object', 'select'].includes(variable.type))
    return typeof value !== 'string' ? false : value.trim() === ''

  return false
}

const hasPendingLocalFiles = (completionFiles: VisionFile[]) => {
  return completionFiles.some(item => item.transfer_method === TransferMethod.local_file && !item.upload_file_id)
}

export const validateResultRequest = ({
  completionFiles,
  inputs,
  isCallBatchAPI,
  promptConfig,
  t,
}: ValidateResultRequestParams): ValidationResult => {
  if (isCallBatchAPI)
    return { canSend: true }

  const promptVariables = promptConfig?.prompt_variables
  if (!promptVariables?.length) {
    if (hasPendingLocalFiles(completionFiles)) {
      return {
        canSend: false,
        notification: {
          type: 'info',
          message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }),
        },
      }
    }

    return { canSend: true }
  }

  const requiredVariables = promptVariables.filter(({ key, name, required, type }) => {
    if (type === 'boolean' || type === 'checkbox')
      return false

    return (!key || !key.trim()) || (!name || !name.trim()) || required === undefined || required === null || required
  })

  const missingRequiredVariable = requiredVariables.find(variable => isMissingRequiredInput(variable, inputs[variable.key]))?.name
  if (missingRequiredVariable) {
    return {
      canSend: false,
      notification: {
        type: 'error',
        message: t('errorMessage.valueOfVarRequired', {
          ns: 'appDebug',
          key: missingRequiredVariable,
        }),
      },
    }
  }

  if (hasPendingLocalFiles(completionFiles)) {
    return {
      canSend: false,
      notification: {
        type: 'info',
        message: t('errorMessage.waitForFileUpload', { ns: 'appDebug' }),
      },
    }
  }

  return { canSend: true }
}

export const buildResultRequestData = ({
  completionFiles,
  inputs,
  promptConfig,
  visionConfig,
}: BuildResultRequestDataParams) => {
  const processedInputs = {
    ...formatBooleanInputs(promptConfig?.prompt_variables, inputs as Record<string, string | number | boolean | object>),
  }

  promptConfig?.prompt_variables.forEach((variable) => {
    const value = processedInputs[variable.key]
    if (variable.type === 'file' && value && typeof value === 'object' && !Array.isArray(value)) {
      processedInputs[variable.key] = getProcessedFiles([value as FileEntity])[0]!
      return
    }

    if (variable.type === 'file-list' && Array.isArray(value) && value.length > 0)
      processedInputs[variable.key] = getProcessedFiles(value as FileEntity[])
  })

  return {
    inputs: processedInputs,
    ...(visionConfig.enabled && completionFiles.length > 0
      ? {
          files: completionFiles.map((item) => {
            if (item.transfer_method === TransferMethod.local_file)
              return { ...item, url: '' }

            return item
          }),
        }
      : {}),
  }
}
