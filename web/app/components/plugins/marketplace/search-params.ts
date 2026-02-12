import { parseAsArrayOf, parseAsString } from 'nuqs/server'

export const CREATION_TYPE = {
  plugins: 'plugins',
  templates: 'templates',
} as const

export type CreationType = typeof CREATION_TYPE[keyof typeof CREATION_TYPE]
export const SEARCH_TABS = ['all', 'plugins', 'templates', 'creators'] as const
export type SearchTab = (typeof SEARCH_TABS)[number] | ''

export const marketplaceSearchParamsParsers = {
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  // Search-page-specific filters (independent from list-page category/tags)
  searchCategories: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  searchLanguages: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  searchType: parseAsString.withDefault('all').withOptions({ history: 'replace' }),
  searchTags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}
