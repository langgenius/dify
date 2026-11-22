import type { I18nText } from '@/i18n/language'
import { consoleQuery } from '@/service/console'

export type CodeBasedExtensionForm = {
  type: string
  label: I18nText
  variable: string
  required: boolean
  options: { label: I18nText; value: string }[]
  default?: string
  placeholder: string
  max_length?: number
}

export type CodeBasedExtensionItem = {
  name: string
  label: I18nText
  form_schema: CodeBasedExtensionForm[]
}
export type CodeBasedExtension = {
  module: string
  data: CodeBasedExtensionItem[]
}

// `label` and `form_schema` are plugin-defined JSON in the console API response.
export const codeBasedExtensionsQueryOptions = (module: string) =>
  consoleQuery.codeBasedExtension.get.queryOptions({
    input: { query: { module } },
    select: (response): CodeBasedExtension => ({
      module: response.module,
      data: response.data.map((item) => ({
        name: item.name,
        label: (item.label ?? {}) as CodeBasedExtensionItem['label'],
        form_schema: (item.form_schema ?? []) as CodeBasedExtensionForm[],
      })),
    }),
  })
