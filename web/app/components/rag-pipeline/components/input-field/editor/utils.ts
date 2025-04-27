import type { InputVar } from '@/app/components/workflow/types'
import type { FormData } from './form/types'
import { getNewVarInWorkflow } from '@/utils/var'

export const convertToInputFieldFormData = (data?: InputVar): FormData => {
  const {
    type,
    label,
    variable,
    max_length,
    'default': defaultValue,
    required,
    hint,
    options,
    placeholder,
    unit,
    allowed_file_upload_methods,
    allowed_file_types,
    allowed_file_extensions,
  } = data || getNewVarInWorkflow('')

  return {
    type,
    label: label as string,
    variable,
    maxLength: max_length,
    default: defaultValue,
    required,
    hint,
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
