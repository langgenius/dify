import type { HumanInputFormDefinition, LegacyHumanInputFormData } from './types'

export const normalizeLegacyHumanInputForm = (
  formData: LegacyHumanInputFormData,
): HumanInputFormDefinition => ({
  branding: {
    site: formData.site.site,
    customConfig: formData.site.custom_config,
  },
  formContent: formData.form_content,
  inputs: formData.inputs,
  resolvedDefaultValues: formData.resolved_default_values,
  actions: formData.user_actions,
  expirationTime: formData.expiration_time,
})
