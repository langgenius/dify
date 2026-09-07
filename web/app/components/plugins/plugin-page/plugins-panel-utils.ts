import type { Collection } from '@/app/components/tools/types'
import { renderI18nObject } from '@/i18n-config'

export const EMPTY_BUILTIN_TOOLS: Collection[] = []

export const filterBuiltinTools = (
  collections: Collection[],
  query: string,
  locale: string,
  tags: string[] = [],
) => {
  if (!query && !tags.length) return collections

  const lowerQuery = query.toLowerCase()
  return collections.filter((collection) => {
    if (tags.length && collection.labels.every((label) => !tags.includes(label))) return false

    if (!query) return true

    if (collection.name.toLowerCase().includes(lowerQuery)) return true

    const label = renderI18nObject(collection.label, locale)
    if (label?.toLowerCase().includes(lowerQuery)) return true

    const description = renderI18nObject(collection.description, locale)
    return !!description?.toLowerCase().includes(lowerQuery)
  })
}
