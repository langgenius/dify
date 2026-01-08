import { parseAsArrayOf, parseAsString } from 'nuqs/server'

export const marketplaceSearchParamsParsers = {
  category: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: false }),
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}
