import type { VarInInspect } from '@/types/workflow'
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
  const showTextEditor = currentVar.value_type === 'secret' || currentVar.value_type === 'string' || currentVar.value_type === 'number'
  const showBoolEditor = typeof currentVar.value === 'boolean'
  const showBoolArrayEditor = Array.isArray(currentVar.value) && currentVar.value.every(v => typeof v === 'boolean')
  const isSysFiles = currentVar.type === VarInInspectType.system && currentVar.name === 'files'
  const showJSONEditor = !isSysFiles && ['object', 'array[string]', 'array[number]', 'array[object]', 'array[any]'].includes(currentVar.value_type)
  const showFileEditor = isSysFiles || currentVar.value_type === 'file' || currentVar.value_type === 'array[file]'
  const textEditorDisabled = currentVar.type === VarInInspectType.environment || (currentVar.type === VarInInspectType.system && currentVar.name !== 'query' && currentVar.name !== 'files')
  const JSONEditorDisabled = currentVar.value_type === 'array[any]'
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

export const formatInspectFileValue = (currentVar: VarInInspect) => {
  if (currentVar.value_type === 'file')
    return currentVar.value ? getProcessedFilesFromResponse([currentVar.value]) : []
  if (currentVar.value_type === 'array[file]' || (currentVar.type === VarInInspectType.system && currentVar.name === 'files'))
    return currentVar.value && currentVar.value.length > 0 ? getProcessedFilesFromResponse(currentVar.value) : []
  return []
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
        return { success: false, validationError: `Schema exceeds maximum depth of ${JSON_SCHEMA_MAX_DEPTH}.`, parseError: null }

      const validationErrors = validateSchemaAgainstDraft7(newJSONSchema)
      if (validationErrors.length > 0)
        return { success: false, validationError: getValidationErrorMessage(validationErrors), parseError: null }
    }

    return { success: true, validationError: '', parseError: null }
  }
  catch (error) {
    return {
      success: false,
      validationError: '',
      parseError: error instanceof Error ? error : new Error('Invalid JSON'),
    }
  }
}

export const isFileValueUploaded = (fileList: UploadedFileLike[]) => fileList.every(file => file.upload_file_id)
