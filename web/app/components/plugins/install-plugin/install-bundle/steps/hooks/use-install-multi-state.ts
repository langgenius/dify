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

export function getPluginKey(plugin: Plugin | undefined): string {
  return `${plugin?.org || plugin?.author}/${plugin?.name}`
}

function parseMarketplaceIdentifier(identifier: string) {
  const [orgPart, nameAndVersionPart] = identifier.split('@')[0].split('/')
  const [name, version] = nameAndVersionPart.split(':')
  return { organization: orgPart, plugin: name, version }
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

  // Marketplace data fetching: by unique identifier and by meta info
  const {
    isLoading: isFetchingById,
    data: infoGetById,
    error: infoByIdError,
  } = useFetchPluginsInMarketPlaceByInfo(
    marketplacePlugins.map(d => parseMarketplaceIdentifier(d.value.marketplace_plugin_unique_identifier!)),
  )

  const {
    isLoading: isFetchingByMeta,
    data: infoByMeta,
    error: infoByMetaError,
  } = useFetchPluginsInMarketPlaceByInfo(
    marketplacePlugins.map(d => d.value!),
  )

  // Derive marketplace plugin data and errors from API responses
  const { marketplacePluginMap, marketplaceErrorIndexes } = useMemo(() => {
    const pluginMap = new Map<number, Plugin>()
    const errorSet = new Set<number>()

    // Process "by ID" response
    if (!isFetchingById && infoGetById?.data.list) {
      const sortedList = marketplacePlugins.map((d) => {
        const id = d.value.marketplace_plugin_unique_identifier?.split(':')[0]
        const retPluginInfo = infoGetById.data.list.find(item => item.plugin.plugin_id === id)?.plugin
        return { ...retPluginInfo, from: d.type } as Plugin
      })
      marketPlaceInDSLIndex.forEach((index, i) => {
        if (sortedList[i]) {
          pluginMap.set(index, {
            ...sortedList[i],
            version: sortedList[i]!.version || sortedList[i]!.latest_version,
          })
        }
        else { errorSet.add(index) }
      })
    }

    // Process "by meta" response (may overwrite "by ID" results)
    if (!isFetchingByMeta && infoByMeta?.data.list) {
      const payloads = infoByMeta.data.list
      marketPlaceInDSLIndex.forEach((index, i) => {
        if (payloads[i]) {
          const item = payloads[i]
          pluginMap.set(index, {
            ...item.plugin,
            plugin_id: item.version.unique_identifier,
          } as Plugin)
        }
        else { errorSet.add(index) }
      })
    }

    // Mark all marketplace indexes as errors on fetch failure
    if (infoByMetaError || infoByIdError)
      marketPlaceInDSLIndex.forEach(index => errorSet.add(index))

    return { marketplacePluginMap: pluginMap, marketplaceErrorIndexes: errorSet }
  }, [isFetchingById, isFetchingByMeta, infoGetById, infoByMeta, infoByMetaError, infoByIdError, marketPlaceInDSLIndex, marketplacePlugins])

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
