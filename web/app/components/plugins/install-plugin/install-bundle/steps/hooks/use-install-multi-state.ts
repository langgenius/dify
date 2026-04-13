'use client'

import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin, VersionInfo } from '@/app/components/plugins/types'
import { useCallback, useEffect, useMemo, useState } from 'react'
import useCheckInstalled from '@/app/components/plugins/install-plugin/hooks/use-check-installed'
import { pluginInstallLimit } from '@/app/components/plugins/install-plugin/hooks/use-install-plugin-limit'
import { useGlobalPublicStore } from '@/context/global-public-context'
import { useFetchPluginsInMarketPlaceByInfo } from '@/service/use-plugins'

type UseInstallMultiStateParams = {
  allPlugins: Dependency[]
  selectedPlugins: Plugin[]
  onSelect: (plugin: Plugin, selectedIndex: number, allCanInstallPluginsLength: number) => void
  onLoadedAllPlugin: (installedInfo: Record<string, VersionInfo>) => void
}

type MarketplacePluginInfo = {
  organization: string
  plugin: string
  version?: string
}

type MarketplaceRequest = {
  dslIndex: number
  dependency: GitHubItemAndMarketPlaceDependency
  info: MarketplacePluginInfo
}

export function getPluginKey(plugin: Plugin | undefined): string {
  return `${plugin?.org || plugin?.author}/${plugin?.name}`
}

function parseMarketplaceIdentifier(identifier?: string): MarketplacePluginInfo | null {
  if (!identifier)
    return null

  const withoutHash = identifier.split('@')[0]
  const [organization, nameAndVersionPart] = withoutHash.split('/')
  if (!organization || !nameAndVersionPart)
    return null

  const [plugin, version] = nameAndVersionPart.split(':')
  if (!plugin)
    return null

  return { organization, plugin, version }
}

function getMarketplacePluginInfo(
  value: GitHubItemAndMarketPlaceDependency['value'],
): MarketplacePluginInfo | null {
  const parsedInfo = parseMarketplaceIdentifier(
    value.marketplace_plugin_unique_identifier || value.plugin_unique_identifier,
  )
  if (parsedInfo)
    return parsedInfo

  if (!value.organization || !value.plugin)
    return null

  return {
    organization: value.organization,
    plugin: value.plugin,
    version: value.version,
  }
}

function initPluginsFromDependencies(allPlugins: Dependency[]): (Plugin | undefined)[] {
  if (!allPlugins.some(d => d.type === 'package'))
    return []

  return allPlugins.map((d) => {
    if (d.type !== 'package')
      return undefined
    const { manifest, unique_identifier } = (d as PackageDependency).value
    return {
      ...manifest,
      plugin_id: unique_identifier,
    } as unknown as Plugin
  })
}

export function useInstallMultiState({
  allPlugins,
  selectedPlugins,
  onSelect,
  onLoadedAllPlugin,
}: UseInstallMultiStateParams) {
  const systemFeatures = useGlobalPublicStore(s => s.systemFeatures)

  // Marketplace plugins filtering and index mapping
  const marketplacePlugins = useMemo(
    () => allPlugins.filter((d): d is GitHubItemAndMarketPlaceDependency => d.type === 'marketplace'),
    [allPlugins],
  )

  const marketPlaceInDSLIndex = useMemo(() => {
    return allPlugins.reduce<number[]>((acc, d, index) => {
      if (d.type === 'marketplace')
        acc.push(index)
      return acc
    }, [])
  }, [allPlugins])

  const { marketplaceRequests, invalidMarketplaceIndexes } = useMemo(() => {
    return marketplacePlugins.reduce<{
      marketplaceRequests: MarketplaceRequest[]
      invalidMarketplaceIndexes: number[]
    }>((acc, dependency, marketplaceIndex) => {
      const dslIndex = marketPlaceInDSLIndex[marketplaceIndex]
      if (dslIndex === undefined)
        return acc

      const marketplaceInfo = getMarketplacePluginInfo(dependency.value)
      if (!marketplaceInfo)
        acc.invalidMarketplaceIndexes.push(dslIndex)
      else
        acc.marketplaceRequests.push({ dslIndex, dependency, info: marketplaceInfo })

      return acc
    }, {
      marketplaceRequests: [],
      invalidMarketplaceIndexes: [],
    })
  }, [marketPlaceInDSLIndex, marketplacePlugins])

  // Marketplace data fetching: by normalized marketplace info
  const {
    isLoading: isFetchingById,
    data: infoGetById,
    error: infoByIdError,
  } = useFetchPluginsInMarketPlaceByInfo(
    marketplaceRequests.map(request => request.info),
  )

  // Derive marketplace plugin data and errors from API responses
  const { marketplacePluginMap, marketplaceErrorIndexes } = useMemo(() => {
    const pluginMap = new Map<number, Plugin>()
    const errorSet = new Set<number>(invalidMarketplaceIndexes)

    // Process "by ID" response
    if (!isFetchingById && infoGetById?.data.list) {
      const payloads = infoGetById.data.list
      const pluginById = new Map(
        payloads.map(item => [item.plugin.plugin_id, item.plugin]),
      )

      marketplaceRequests.forEach((request, requestIndex) => {
        const pluginId = (
          request.dependency.value.marketplace_plugin_unique_identifier
          || request.dependency.value.plugin_unique_identifier
        )?.split(':')[0]
        const pluginInfo = (pluginId ? pluginById.get(pluginId) : undefined) || payloads[requestIndex]?.plugin

        if (pluginInfo) {
          pluginMap.set(request.dslIndex, {
            ...pluginInfo,
            from: request.dependency.type,
            version: pluginInfo.version || pluginInfo.latest_version,
          })
        }
        else { errorSet.add(request.dslIndex) }
      })
    }

    // Mark all marketplace indexes as errors on fetch failure
    if (infoByIdError)
      marketPlaceInDSLIndex.forEach(index => errorSet.add(index))

    return { marketplacePluginMap: pluginMap, marketplaceErrorIndexes: errorSet }
  }, [invalidMarketplaceIndexes, isFetchingById, infoGetById, infoByIdError, marketPlaceInDSLIndex, marketplaceRequests])

  // GitHub-fetched plugins and errors (imperative state from child callbacks)
  const [githubPluginMap, setGithubPluginMap] = useState<Map<number, Plugin>>(() => new Map())
  const [githubErrorIndexes, setGithubErrorIndexes] = useState<number[]>([])

  // Merge all plugin sources into a single array
  const plugins = useMemo(() => {
    const initial = initPluginsFromDependencies(allPlugins)
    const result: (Plugin | undefined)[] = allPlugins.map((_, i) => initial[i])
    marketplacePluginMap.forEach((plugin, index) => {
      result[index] = plugin
    })
    githubPluginMap.forEach((plugin, index) => {
      result[index] = plugin
    })
    return result
  }, [allPlugins, marketplacePluginMap, githubPluginMap])

  // Merge all error sources
  const errorIndexes = useMemo(() => {
    return [...marketplaceErrorIndexes, ...githubErrorIndexes]
  }, [marketplaceErrorIndexes, githubErrorIndexes])

  // Check installed status after all data is loaded
  const isLoadedAllData = (plugins.filter(Boolean).length + errorIndexes.length) === allPlugins.length

  const { installedInfo } = useCheckInstalled({
    pluginIds: plugins.filter(Boolean).map(d => getPluginKey(d)) || [],
    enabled: isLoadedAllData,
  })

  // Notify parent when all plugin data and install info is ready
  useEffect(() => {
    if (isLoadedAllData && installedInfo)
      onLoadedAllPlugin(installedInfo!)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadedAllData, installedInfo])

  // Callback: handle GitHub plugin fetch success
  const handleGitHubPluginFetched = useCallback((index: number) => {
    return (p: Plugin) => {
      setGithubPluginMap(prev => new Map(prev).set(index, p))
    }
  }, [])

  // Callback: handle GitHub plugin fetch error
  const handleGitHubPluginFetchError = useCallback((index: number) => {
    return () => {
      setGithubErrorIndexes(prev => [...prev, index])
    }
  }, [])

  // Callback: get version info for a plugin by its key
  const getVersionInfo = useCallback((pluginId: string) => {
    const pluginDetail = installedInfo?.[pluginId]
    return {
      hasInstalled: !!pluginDetail,
      installedVersion: pluginDetail?.installedVersion,
      toInstallVersion: '',
    }
  }, [installedInfo])

  // Callback: handle plugin selection
  const handleSelect = useCallback((index: number) => {
    return () => {
      const canSelectPlugins = plugins.filter((p) => {
        const { canInstall } = pluginInstallLimit(p!, systemFeatures)
        return canInstall
      })
      onSelect(plugins[index]!, index, canSelectPlugins.length)
    }
  }, [onSelect, plugins, systemFeatures])

  // Callback: check if a plugin at given index is selected
  const isPluginSelected = useCallback((index: number) => {
    return !!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)
  }, [selectedPlugins, plugins])

  // Callback: get all installable plugins with their indexes
  const getInstallablePlugins = useCallback(() => {
    const selectedIndexes: number[] = []
    const installablePlugins: Plugin[] = []
    allPlugins.forEach((_d, index) => {
      const p = plugins[index]
      if (!p)
        return
      const { canInstall } = pluginInstallLimit(p, systemFeatures)
      if (canInstall) {
        selectedIndexes.push(index)
        installablePlugins.push(p)
      }
    })
    return { selectedIndexes, installablePlugins }
  }, [allPlugins, plugins, systemFeatures])

  return {
    plugins,
    errorIndexes,
    handleGitHubPluginFetched,
    handleGitHubPluginFetchError,
    getVersionInfo,
    handleSelect,
    isPluginSelected,
    getInstallablePlugins,
  }
}
