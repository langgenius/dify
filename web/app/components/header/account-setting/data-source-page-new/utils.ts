import type { I18nObject, ProviderConfig } from '@dify/contracts/api/console/auth/types.gen'
import type { FormOption, FormSchema, TypeWithI18N } from '@/app/components/base/form/types'

// Untranslated locales fall back to en_US, matching renderI18nObject.
const toTypeWithI18N = ({ en_US, ja_JP, pt_BR, zh_Hans }: I18nObject): TypeWithI18N => ({
  en_US,
  zh_Hans: zh_Hans ?? en_US,
  ...(ja_JP != null && { ja_JP }),
  ...(pt_BR != null && { pt_BR }),
})

export const providerConfigToFormSchema = (config: ProviderConfig): FormSchema => ({
  type: config.type,
  name: config.name,
  label: config.label ? toTypeWithI18N(config.label) : config.name,
  required: config.required ?? false,
  multiple: config.multiple,
  default: config.default ?? undefined,
  scope: config.scope ?? undefined,
  url: config.url ?? undefined,
  help: config.help ? toTypeWithI18N(config.help) : undefined,
  placeholder: config.placeholder ? toTypeWithI18N(config.placeholder) : undefined,
  options: config.options?.map((option): FormOption => ({
    label: toTypeWithI18N(option.label),
    value: option.value,
  })),
})
