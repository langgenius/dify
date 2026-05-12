import { PLUGIN_TYPE_SEARCH_MAP } from './marketplace/constants'

export type LegacyPluginsSearchParams = Record<string, string | string[] | undefined>

const INSTALLED_PLUGINS_TAB = 'plugins'
const MARKETPLACE_TAB = 'discover'

const marketplacePluginTabs = new Set<string>([
  MARKETPLACE_TAB,
  ...Object.values(PLUGIN_TYPE_SEARCH_MAP),
])

const getFirstSearchParamValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value))
    return value[0]

  return value
}

export const getLegacyPluginRedirectPath = (
  searchParams: LegacyPluginsSearchParams = {},
) => {
  const tab = getFirstSearchParamValue(searchParams.tab)

  if (!tab || tab === INSTALLED_PLUGINS_TAB)
    return '/integrations'

  if (marketplacePluginTabs.has(tab))
    return undefined

  return undefined
}
