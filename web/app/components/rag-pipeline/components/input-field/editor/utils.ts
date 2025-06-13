import type { InputVar } from '@/models/pipeline'
import type { FormData } from './form/types'
import { VAR_ITEM_TEMPLATE_IN_PIPELINE } from '@/config'

const getNewInputVarInRagPipeline = (): InputVar => {
  return {
    ...VAR_ITEM_TEMPLATE_IN_PIPELINE,
  }
}

export const convertToInputFieldFormData = (data?: InputVar): FormData => {
  const {
    type,
    label,
    variable,
    max_length,
    default_value,
    required,
    tooltips,
    options,
    placeholder,
    unit,
    allowed_file_upload_methods,
    allowed_file_types,
    allowed_file_extensions,
  } = data || getNewInputVarInRagPipeline()

  const formData: FormData = {
    type,
    label,
    variable,
    maxLength: max_length,
    required,
    options,
    allowedTypesAndExtensions: {},
  }

  if (default_value !== undefined && default_value !== null)
    formData.default = default_value
  if (tooltips !== undefined && tooltips !== null)
    formData.tooltips = tooltips
  if (placeholder !== undefined && placeholder !== null)
    formData.placeholder = placeholder
  if (unit !== undefined && unit !== null)
    formData.unit = unit
  if (allowed_file_upload_methods)
    formData.allowedFileUploadMethods = allowed_file_upload_methods
  if (allowed_file_types && allowed_file_extensions) {
    formData.allowedTypesAndExtensions = {
      allowedFileTypes: allowed_file_types,
      allowedFileExtensions: allowed_file_extensions,
    }
  }

  return formData
}

export const convertFormDataToINputField = (data: FormData): InputVar => {
  const {
    type,
    label,
    variable,
    maxLength,
    default: defaultValue,
    required,
    tooltips,
    options,
    placeholder,
    unit,
    allowedFileUploadMethods,
    allowedTypesAndExtensions: { allowedFileTypes, allowedFileExtensions },
  } = data

  return {
    type,
    label,
    variable,
    max_length: maxLength,
    default_value: defaultValue,
    required,
    tooltips,
    options,
    placeholder,
    unit,
    allowed_file_upload_methods: allowedFileUploadMethods,
    allowed_file_types: allowedFileTypes,
    allowed_file_extensions: allowedFileExtensions,
  }
}
