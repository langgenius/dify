import type {
  CodeBasedExtension,
  CodeBasedExtensionForm,
  CodeBasedExtensionItem,
} from '@/models/common'
import { consoleQuery } from '@/service/console'

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
