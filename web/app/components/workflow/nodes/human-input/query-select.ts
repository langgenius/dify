import type {
  FormInputConfig,
  HumanInputFormPreviewResponse,
} from '@dify/contracts/api/console/apps/types.gen'
import type { FormInputItem } from './types'
import type { HumanInputFormData } from '@/types/workflow'

const selectFormInput = (input: FormInputConfig): FormInputItem => {
  switch (input.type) {
    case 'paragraph':
      return {
        ...input,
        default: {
          type: input.default?.type ?? 'constant',
          selector: input.default?.selector ?? [],
          value: input.default?.value ?? '',
        },
      }
    case 'select':
      return {
        ...input,
        option_source: {
          ...input.option_source,
          selector: input.option_source.selector ?? [],
          value: input.option_source.value ?? [],
        },
      }
    case 'file':
    case 'file-list':
      return {
        ...input,
        allowed_file_extensions: input.allowed_file_extensions ?? [],
        allowed_file_types: input.allowed_file_types ?? [],
        allowed_file_upload_methods: input.allowed_file_upload_methods ?? [],
      }
  }
}

export const selectHumanInputFormPreview = (
  response: HumanInputFormPreviewResponse,
): HumanInputFormData => ({
  ...response,
  inputs: (response.inputs ?? []).map(selectFormInput),
  actions: (response.actions ?? []).map((action) => ({
    ...action,
    button_style: action.button_style ?? 'default',
  })),
  form_token: response.form_token ?? null,
  display_in_ui: response.display_in_ui ?? false,
  expiration_time: response.expiration_time ?? null,
  resolved_default_values: response.resolved_default_values ?? {},
})
