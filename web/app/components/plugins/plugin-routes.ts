import { PLUGIN_TYPE_SEARCH_MAP } from './marketplace/constants'

export type LegacyPluginsSearchParams = Record<string, string | string[] | undefined>

const INSTALLED_PLUGINS_TAB = 'plugins'
const MARKETPLACE_TAB = 'discover'
const installSearchParamKeys = new Set(['package-ids', 'bundle-info'])
const PACKAGE_IDS_SEARCH_PARAM = 'package-ids'

const integrationPluginPathByTab = new Map<string, string>([
  ['trigger', '/integrations/trigger'],
  ['agent-strategy', '/integrations/agent-strategy'],
  ['extension', '/integrations/extension'],
])

const integrationPluginPathByInstallCategory = new Map<string, string>([
  ['model', '/integrations/model-provider'],
  ['tool', '/integrations/tools/built-in'],
  ['datasource', '/integrations/data-source'],
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
  if (Array.isArray(value)) return value[0]

  return value
}

const hasInstallSearchParams = (searchParams: LegacyPluginsSearchParams) => {
  return Object.keys(searchParams).some((key) => installSearchParamKeys.has(key))
}

export const getFirstPackageIdFromSearchParams = (searchParams: LegacyPluginsSearchParams) => {
  const value = getFirstSearchParamValue(searchParams[PACKAGE_IDS_SEARCH_PARAM])
  if (!value) return null

  try {
    const parsed: unknown = JSON.parse(value)
    if (Array.isArray(parsed)) {
      const first = parsed[0]
      return typeof first === 'string' ? first : null
    }
  } catch {
    return value
  }

  return value
}

export const shouldResolveInstallCategoryRedirect = (searchParams: LegacyPluginsSearchParams) => {
  const tab = getFirstSearchParamValue(searchParams.tab)
  return (
    (!tab || tab === INSTALLED_PLUGINS_TAB) && !!getFirstPackageIdFromSearchParams(searchParams)
  )
}

const buildPreservedSearchParams = (
  searchParams: LegacyPluginsSearchParams,
  ignoredKeys: Set<string>,
) => {
  const preservedSearchParams = new URLSearchParams()

  Object.entries(searchParams).forEach(([key, value]) => {
    if (ignoredKeys.has(key) || value === undefined) return

    if (Array.isArray(value)) {
      value.forEach((item) => preservedSearchParams.append(key, item))
      return
    }

    preservedSearchParams.set(key, value)
  })

  return preservedSearchParams
}

const buildRedirectPath = (
  path: string,
  searchParams: LegacyPluginsSearchParams,
  ignoredKeys: Set<string>,
) => {
  const query = buildPreservedSearchParams(searchParams, ignoredKeys).toString()
  return query ? `${path}?${query}` : path
}

const buildInstallRedirectPath = (path: string, searchParams: LegacyPluginsSearchParams) => {
  const installSearchParams: LegacyPluginsSearchParams = {}

  Object.entries(searchParams).forEach(([key, value]) => {
    if (installSearchParamKeys.has(key)) installSearchParams[key] = value
  })

  return buildRedirectPath(path, installSearchParams, new Set())
}

export const getInstallRedirectPathByPluginCategory = (
  category: string | undefined,
  searchParams: LegacyPluginsSearchParams,
) => {
  if (!category) return undefined

  const path = integrationPluginPathByInstallCategory.get(category)
  if (!path) return undefined

  return buildInstallRedirectPath(path, searchParams)
}

export const getInstallRedirectPathFromSearchParams = (searchParams: LegacyPluginsSearchParams) => {
  if (!hasInstallSearchParams(searchParams)) return undefined

  const category = getFirstSearchParamValue(searchParams.category)
  const pathByCategory = getInstallRedirectPathByPluginCategory(category, searchParams)
  if (pathByCategory) return pathByCategory

  const tab = getFirstSearchParamValue(searchParams.tab)
  return getInstallRedirectPathByPluginCategory(tab, searchParams)
}

const buildMarketplaceRedirectPath = (searchParams: LegacyPluginsSearchParams, tab: string) => {
  const path = '/marketplace'
  const ignoredKeys = new Set(['tab'])
  const preservedSearchParams = buildPreservedSearchParams(searchParams, ignoredKeys)

  if (tab !== MARKETPLACE_TAB && !preservedSearchParams.has('category'))
    preservedSearchParams.set('category', tab)

  const query = preservedSearchParams.toString()
  return query ? `${path}?${query}` : path
}

export const getLegacyPluginRedirectPath = (searchParams: LegacyPluginsSearchParams = {}) => {
  const tab = getFirstSearchParamValue(searchParams.tab)

  if ((!tab || tab === INSTALLED_PLUGINS_TAB) && hasInstallSearchParams(searchParams))
    return undefined

  if (!tab || tab === INSTALLED_PLUGINS_TAB) return '/integrations'

  const integrationPluginPath = getIntegrationPluginPathByTab(tab)
  if (integrationPluginPath) {
    return hasInstallSearchParams(searchParams)
      ? buildInstallRedirectPath(integrationPluginPath, searchParams)
      : buildRedirectPath(integrationPluginPath, searchParams, new Set(['tab']))
  }

  if (marketplacePluginTabs.has(tab)) return buildMarketplaceRedirectPath(searchParams, tab)

  return undefined
}
