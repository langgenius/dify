import { parseAsArrayOf, parseAsString, parseAsStringEnum } from 'nuqs/server'

export type CreationType = 'plugins' | 'templates'

export const marketplaceSearchParamsParsers = {
  category: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: false }),
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
  creationType: parseAsStringEnum<CreationType>(['plugins', 'templates']).withDefault('plugins').withOptions({ history: 'replace' }),
  searchTab: parseAsStringEnum<SearchTab>(['all', 'plugins', 'templates', 'creators']).withDefault('').withOptions({ history: 'replace' }),
}

export type SearchTab = 'all' | 'plugins' | 'templates' | 'creators' | ''
