import type { FileResponse, VarInInspect } from '@/types/workflow'
import { zFileTransferMethod } from '@dify/contracts/api/console/apps/zod.gen'
import { getProcessedFilesFromResponse } from '@/app/components/base/file-uploader/utils'
import {
  checkJsonSchemaDepth,
  getValidationErrorMessage,
  validateSchemaAgainstDraft7,
} from '@/app/components/workflow/nodes/llm/utils'
import { JSON_SCHEMA_MAX_DEPTH } from '@/config'
import { VarInInspectType } from '@/types/workflow'
import { CHUNK_SCHEMA_TYPES } from './types'
import { validateJSONSchema } from './utils'

type UploadedFileLike = {
  upload_file_id?: string
}

export const getValueEditorState = (currentVar: VarInInspect) => {
  const valueType = String(currentVar.value_type)
  const showTextEditor =
    currentVar.value_type === 'secret' ||
    currentVar.value_type === 'string' ||
    currentVar.value_type === 'number'
  const showBoolEditor = typeof currentVar.value === 'boolean'
  const showBoolArrayEditor =
    Array.isArray(currentVar.value) && currentVar.value.every((v) => typeof v === 'boolean')
  const isSysFiles = currentVar.type === VarInInspectType.system && currentVar.name === 'files'
  const showJSONEditor =
    !isSysFiles &&
    ['object', 'array[string]', 'array[number]', 'array[object]', 'array[any]', 'llm'].includes(
      valueType,
    )
  const showFileEditor =
    isSysFiles || currentVar.value_type === 'file' || currentVar.value_type === 'array[file]'
  const textEditorDisabled =
    currentVar.type === VarInInspectType.environment ||
    (currentVar.type === VarInInspectType.system &&
      currentVar.name !== 'query' &&
      currentVar.name !== 'files')
  const JSONEditorDisabled = valueType === 'array[any]' || valueType === 'llm'
  const hasChunks = !!currentVar.schemaType && CHUNK_SCHEMA_TYPES.includes(currentVar.schemaType)

  return {
    showTextEditor,
    showBoolEditor,
    showBoolArrayEditor,
    isSysFiles,
    showJSONEditor,
    showFileEditor,
    textEditorDisabled,
    JSONEditorDisabled,
    hasChunks,
  }
}

const toInspectFile = (value: unknown): FileResponse | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const transferMethod = zFileTransferMethod.safeParse(
    'transfer_method' in value ? value.transfer_method : undefined,
  )
  if (!transferMethod.success) return undefined
  const stringField = (key: string) => {
    const field = Reflect.get(value, key)
    return typeof field === 'string' ? field : ''
  }
  return {
    related_id: stringField('related_id'),
    extension: stringField('extension'),
    filename: stringField('filename'),
    size: 'size' in value && typeof value.size === 'number' ? value.size : 0,
    mime_type: stringField('mime_type'),
    transfer_method: transferMethod.data,
    type: stringField('type'),
    url: stringField('url'),
    upload_file_id: stringField('upload_file_id'),
    remote_url: stringField('remote_url'),
  }
}

export const formatInspectFileValue = (currentVar: VarInInspect) => {
  const values =
    currentVar.value_type === 'file'
      ? [currentVar.value]
      : (currentVar.value_type === 'array[file]' ||
            (currentVar.type === VarInInspectType.system && currentVar.name === 'files')) &&
          Array.isArray(currentVar.value)
        ? currentVar.value
        : []
  return getProcessedFilesFromResponse(
    values.flatMap((value) => {
      const file = toInspectFile(value)
      return file ? [file] : []
    }),
  )
}

export const validateInspectJsonValue = (value: string, type: string) => {
  try {
    const newJSONSchema = JSON.parse(value)
    const result = validateJSONSchema(newJSONSchema, type)
    if (!result.success)
      return { success: false, validationError: result.error.message, parseError: null }

    if (type === 'object' || type === 'array[object]') {
      const schemaDepth = checkJsonSchemaDepth(newJSONSchema)
      if (schemaDepth > JSON_SCHEMA_MAX_DEPTH)
        return {
          success: false,
          validationError: `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`,
          parseError: null,
        }

      const validationErrors = validateSchemaAgainstDraft7(newJSONSchema)
      if (validationErrors.length > 0)
        return {
          success: false,
          validationError: getValidationErrorMessage(validationErrors),
          parseError: null,
        }
    }

    return { success: true, validationError: '', parseError: null }
  } catch (error) {
    return {
      success: false,
      validationError: '',
      parseError: error instanceof Error ? error : new Error('Invalid JSON'),
    }
  }
}

export const isFileValueUploaded = (fileList: UploadedFileLike[]) =>
  fileList.every((file) => file.upload_file_id)
