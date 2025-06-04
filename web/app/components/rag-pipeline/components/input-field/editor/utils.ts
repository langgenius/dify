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

  return {
    type,
    label,
    variable,
    maxLength: max_length,
    default: default_value,
    required,
    tooltips,
    options,
    placeholder,
    unit,
    allowedFileUploadMethods: allowed_file_upload_methods,
    allowedTypesAndExtensions: {
      allowedFileTypes: allowed_file_types,
      allowedFileExtensions: allowed_file_extensions,
    },
  }
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
