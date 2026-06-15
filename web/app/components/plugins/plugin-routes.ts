import { PLUGIN_TYPE_SEARCH_MAP } from './marketplace/constants'

export type LegacyPluginsSearchParams = Record<string, string | string[] | undefined>

const INSTALLED_PLUGINS_TAB = 'plugins'
const MARKETPLACE_TAB = 'discover'

const integrationPluginPathByTab = new Map<string, string>([
  ['trigger', '/integrations/trigger'],
  ['agent-strategy', '/integrations/agent-strategy'],
  ['extension', '/integrations/extension'],
])

const getIntegrationPluginPathByTab = (tab: string) => {
  return integrationPluginPathByTab.get(tab)
}

const marketplacePluginTabs = new Set<string>([
  MARKETPLACE_TAB,
  ...Object.values(PLUGIN_TYPE_SEARCH_MAP),
])

const getFirstSearchParamValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value))
    return value[0]

  return value
}

const buildMarketplaceRedirectPath = (
  searchParams: LegacyPluginsSearchParams,
  tab: string,
) => {
  const preservedSearchParams = new URLSearchParams()

  Object.entries(searchParams).forEach(([key, value]) => {
    if (key === 'tab' || value === undefined)
      return

    if (Array.isArray(value)) {
      value.forEach(item => preservedSearchParams.append(key, item))
      return
    }

    preservedSearchParams.set(key, value)
  })

  if (tab !== MARKETPLACE_TAB && !preservedSearchParams.has('category'))
    preservedSearchParams.set('category', tab)

  const query = preservedSearchParams.toString()
  return query ? `/marketplace?${query}` : '/marketplace'
}

export const getLegacyPluginRedirectPath = (
  searchParams: LegacyPluginsSearchParams = {},
) => {
  const tab = getFirstSearchParamValue(searchParams.tab)

  if (!tab || tab === INSTALLED_PLUGINS_TAB)
    return '/integrations'

  const integrationPluginPath = getIntegrationPluginPathByTab(tab)
  if (integrationPluginPath)
    return integrationPluginPath

  if (marketplacePluginTabs.has(tab))
    return buildMarketplaceRedirectPath(searchParams, tab)

  return undefined
}
