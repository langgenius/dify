import { parseAsArrayOf, parseAsString, parseAsStringEnum } from 'nuqs/server'

export const CREATION_TYPE = {
  plugins: 'plugins',
  templates: 'templates',
} as const

export type CreationType = typeof CREATION_TYPE[keyof typeof CREATION_TYPE]

export const marketplaceSearchParamsParsers = {
  category: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: false }),
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  creationType: parseAsStringEnum<CreationType>([CREATION_TYPE.plugins, CREATION_TYPE.templates]).withDefault(CREATION_TYPE.plugins).withOptions({ history: 'replace' }),
  searchTab: parseAsStringEnum<SearchTab>(['all', 'plugins', 'templates', 'creators']).withDefault('').withOptions({ history: 'replace' }),
  // Search-page-specific filters (independent from list-page category/tags)
  searchCategories: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  searchLanguages: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  searchType: parseAsString.withDefault('all').withOptions({ history: 'replace' }),
  searchTags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}

export type SearchTab = 'all' | 'plugins' | 'templates' | 'creators' | ''
