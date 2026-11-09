import type { I18nObject, ProviderConfig } from '@dify/contracts/api/console/workspaces/types.gen'
import type { FormSchema, TypeWithI18N } from '@/app/components/base/form/types'

function selectLabel(label: I18nObject, fallback = label.en_US): TypeWithI18N {
  return {
    en_US: label.en_US,
    zh_Hans: label.zh_Hans ?? fallback,
    ...(label.ja_JP != null ? { ja_JP: label.ja_JP } : {}),
    ...(label.pt_BR != null ? { pt_BR: label.pt_BR } : {}),
  }
}

export function selectCredentialFormSchema(schema: ProviderConfig): FormSchema {
  return {
    type: schema.type,
    name: schema.name,
    label: schema.label ? selectLabel(schema.label) : schema.name,
    required: schema.required ?? false,
    multiple: schema.multiple,
    default: schema.default ?? undefined,
    scope: schema.scope ?? undefined,
    help: schema.help ? selectLabel(schema.help) : undefined,
    url: schema.url ?? undefined,
    placeholder: schema.placeholder ? selectLabel(schema.placeholder) : undefined,
    options: schema.options?.map((option) => ({
      value: option.value,
      label: selectLabel(option.label),
    })),
  }
}
