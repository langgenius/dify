import type { FormField } from '../../types'
import { fileIsUploaded, getProcessedFiles } from '@/app/components/base/file-uploader/utils'
import { FILE_EXTS } from '@/app/components/base/prompt-editor/constants'
import { SupportUploadFileTypes } from '@/app/components/workflow/types'
import { TransferMethod } from '@/types/app'
import { FILE_FIELD_TYPES, toFileEntities } from '../../form-files'

export const MULTI_FILE_FIELD_TYPES = new Set(['file-list', 'files'])

export const DEFAULT_ALLOWED_FILE_TYPES = [
  SupportUploadFileTypes.image,
  SupportUploadFileTypes.document,
  SupportUploadFileTypes.audio,
  SupportUploadFileTypes.video,
]

export const DEFAULT_ALLOWED_FILE_EXTENSIONS = DEFAULT_ALLOWED_FILE_TYPES.flatMap(
  (type) => FILE_EXTS[type] ?? [],
)

export const DEFAULT_ALLOWED_FILE_UPLOAD_METHODS = [
  TransferMethod.local_file,
  TransferMethod.remote_url,
]

export const FILE_TYPE_VALUES = new Set<string>(Object.values(SupportUploadFileTypes))

export const FILE_UPLOAD_METHOD_VALUES = new Set<string>(Object.values(TransferMethod))

export const EMPTY_FORM_FIELDS: FormField[] = []

export type FormValidationError =
  | 'invalid-json'
  | 'invalid-json-object'
  | 'invalid-number'
  | 'invalid-option'
  | 'invalid-value'
  | 'max-files'
  | 'max-length'
  | 'required'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const initialFormValues = (fields: FormField[], values?: Record<string, unknown>) => {
  const defaults: Record<string, unknown> = {}
  fields.forEach((field) => {
    if (field.default !== undefined && field.default !== null) defaults[field.key] = field.default
  })
  return { ...defaults, ...(values ?? {}) }
}

const setValidationError = (
  errors: Record<string, FormValidationError>,
  key: string,
  error: FormValidationError,
) => {
  errors[key] = error
  return false
}

export const prepareFormValues = (fields: FormField[], values: Record<string, unknown>) => {
  const preparedValues = { ...values }
  const errors: Record<string, FormValidationError> = {}
  let valid = true

  fields.forEach((field) => {
    const value = values[field.key]

    if (field.type === 'bool' || field.type === 'checkbox') {
      preparedValues[field.key] = value === true
      return
    }

    if (field.type === 'number') {
      if (typeof value === 'number' && !Number.isNaN(value)) preparedValues[field.key] = value
      else if (typeof value === 'string' && value !== '') {
        const numberValue = Number(value)
        if (!Number.isNaN(numberValue)) preparedValues[field.key] = numberValue
        else {
          delete preparedValues[field.key]
          valid = setValidationError(errors, field.key, 'invalid-number')
        }
      } else delete preparedValues[field.key]
      if (!(field.key in preparedValues) && field.required && !errors[field.key])
        valid = setValidationError(errors, field.key, 'required')
      return
    }

    if (field.type === 'json' || field.type === 'json_object') {
      if (typeof value === 'string') {
        if (value.trim() === '') {
          delete preparedValues[field.key]
          if (field.required) valid = setValidationError(errors, field.key, 'required')
          return
        }

        try {
          const parsed = JSON.parse(value) as unknown
          if (field.type === 'json_object' && !isRecord(parsed)) {
            valid = setValidationError(errors, field.key, 'invalid-json-object')
            delete preparedValues[field.key]
            return
          }
          preparedValues[field.key] = parsed
        } catch {
          valid = setValidationError(errors, field.key, 'invalid-json')
          delete preparedValues[field.key]
        }
      } else if (field.type === 'json_object' && value != null && !isRecord(value)) {
        valid = setValidationError(errors, field.key, 'invalid-json-object')
        delete preparedValues[field.key]
      } else if (value == null) {
        delete preparedValues[field.key]
        if (field.required) valid = setValidationError(errors, field.key, 'required')
      }
      return
    }

    if (FILE_FIELD_TYPES.has(field.type)) {
      const files = toFileEntities(value)
      if (!files.every(fileIsUploaded)) valid = false

      const processedFiles = getProcessedFiles(files.filter(fileIsUploaded))
      const fileLimit = MULTI_FILE_FIELD_TYPES.has(field.type)
        ? (field.number_limits ?? field.max_length)
        : 1
      if (processedFiles.length === 0 && field.required)
        valid = setValidationError(errors, field.key, 'required')
      if (fileLimit && processedFiles.length > fileLimit)
        valid = setValidationError(errors, field.key, 'max-files')
      if (MULTI_FILE_FIELD_TYPES.has(field.type)) {
        if (processedFiles.length > 0) preparedValues[field.key] = processedFiles
        else delete preparedValues[field.key]
      } else if (processedFiles.length > 0) preparedValues[field.key] = processedFiles[0]
      else delete preparedValues[field.key]
      return
    }

    if (value == null || (typeof value === 'string' && value.trim() === '')) {
      delete preparedValues[field.key]
      if (field.required) valid = setValidationError(errors, field.key, 'required')
      return
    }

    if (typeof value !== 'string') {
      delete preparedValues[field.key]
      valid = setValidationError(errors, field.key, 'invalid-value')
      return
    }

    if (field.type === 'select' && !(field.options ?? []).includes(value)) {
      delete preparedValues[field.key]
      valid = setValidationError(errors, field.key, 'invalid-option')
      return
    }

    if (field.max_length && value.length > field.max_length)
      valid = setValidationError(errors, field.key, 'max-length')
  })

  return { errors, preparedValues, valid }
}

export const getFormActionPayload = (
  actionId: string,
  fields: FormField[],
  preparedValues: Record<string, unknown>,
) => {
  const payload = { ...preparedValues }
  if (actionId === 'provide_testdata') return { mode: 'provide', inputs: payload }

  // Requirements and edit rules merge into existing values; null clears a field.
  fields.forEach(({ key }) => {
    if (!(key in payload)) payload[key] = null
  })
  return payload
}
