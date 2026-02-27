import type { ActivePluginType } from './constants'
import { parseAsArrayOf, parseAsString, parseAsStringEnum } from 'nuqs/server'
import { PLUGIN_TYPE_SEARCH_MAP } from './constants'

export const marketplaceSearchParamsParsers = {
  category: parseAsStringEnum<ActivePluginType>(Object.values(PLUGIN_TYPE_SEARCH_MAP) as ActivePluginType[]).withDefault('all').withOptions({ history: 'replace', clearOnDefault: false }),
  q: parseAsString.withDefault('').withOptions({ history: 'replace' }),
  tags: parseAsArrayOf(parseAsString).withDefault([]).withOptions({ history: 'replace' }),
}
