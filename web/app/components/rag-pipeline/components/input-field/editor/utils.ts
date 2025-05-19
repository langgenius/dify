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
    'default': defaultValue,
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
    default: defaultValue,
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
