'use client'
import type { FC } from 'react'
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dependency, GitHubItemAndMarketPlaceDependency, PackageDependency, Plugin } from '../../../types'
import MarketplaceItem from '../item/marketplace-item'
import GithubItem from '../item/github-item'
import { useFetchPluginsInMarketPlaceByIds, useFetchPluginsInMarketPlaceByInfo } from '@/service/use-plugins'
import produce from 'immer'
import PackageItem from '../item/package-item'
import LoadingError from '../../base/loading-error'

type Props = {
  allPlugins: Dependency[]
  selectedPlugins: Plugin[]
  onSelect: (plugin: Plugin, selectedIndex: number) => void
  onLoadedAllPlugin: () => void
}

const InstallByDSLList: FC<Props> = ({
  allPlugins,
  selectedPlugins,
  onSelect,
  onLoadedAllPlugin,
}) => {
  // DSL has id, to get plugin info to show more info
  const { isLoading: isFetchingMarketplaceDataById, data: infoGetById, error: infoByIdError } = useFetchPluginsInMarketPlaceByIds(allPlugins.filter(d => d.type === 'marketplace').map(d => (d as GitHubItemAndMarketPlaceDependency).value.plugin_unique_identifier!))
  // has meta(org,name,version), to get id
  const { isLoading: isFetchingDataByMeta, data: infoByMeta, error: infoByMetaError } = useFetchPluginsInMarketPlaceByInfo(allPlugins.filter(d => d.type === 'marketplace').map(d => (d as GitHubItemAndMarketPlaceDependency).value!))
  const [plugins, doSetPlugins] = useState<(Plugin | undefined)[]>((() => {
    const hasLocalPackage = allPlugins.some(d => d.type === 'package')
    if (!hasLocalPackage)
      return []

    const _plugins = allPlugins.map((d) => {
      if (d.type === 'package') {
        return {
          ...(d as any).value.manifest,
          plugin_id: (d as any).value.unique_identifier,
        }
      }

      return undefined
    })
    return _plugins
  })())
  const pluginsRef = React.useRef<(Plugin | undefined)[]>(plugins)

  const setPlugins = useCallback((p: (Plugin | undefined)[]) => {
    doSetPlugins(p)
    pluginsRef.current = p
  }, [])

  const [errorIndexes, setErrorIndexes] = useState<number[]>([])

  const handleGitHubPluginFetched = useCallback((index: number) => {
    return (p: Plugin) => {
      const nextPlugins = produce(pluginsRef.current, (draft) => {
        draft[index] = p
      })
      setPlugins(nextPlugins)
    }
  }, [setPlugins])

  const handleGitHubPluginFetchError = useCallback((index: number) => {
    return () => {
      setErrorIndexes([...errorIndexes, index])
    }
  }, [errorIndexes])

  const marketPlaceInDSLIndex = useMemo(() => {
    const res: number[] = []
    allPlugins.forEach((d, index) => {
      if (d.type === 'marketplace')
        res.push(index)
    })
    return res
  }, [allPlugins])

  useEffect(() => {
    if (!isFetchingMarketplaceDataById && infoGetById?.data.plugins) {
      const payloads = infoGetById?.data.plugins
      const failedIndex: number[] = []
      const nextPlugins = produce(pluginsRef.current, (draft) => {
        marketPlaceInDSLIndex.forEach((index, i) => {
          if (payloads[i])
            draft[index] = payloads[i]
          else
            failedIndex.push(index)
        })
      })
      setPlugins(nextPlugins)

      if (failedIndex.length > 0)
        setErrorIndexes([...errorIndexes, ...failedIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingMarketplaceDataById])

  useEffect(() => {
    if (!isFetchingDataByMeta && infoByMeta?.data.list) {
      const payloads = infoByMeta?.data.list
      const failedIndex: number[] = []
      const nextPlugins = produce(pluginsRef.current, (draft) => {
        marketPlaceInDSLIndex.forEach((index, i) => {
          if (payloads[i]) {
            const item = payloads[i]
            draft[index] = {
              ...item.plugin,
              plugin_id: item.version.unique_identifier,
            }
          }
          else {
            failedIndex.push(index)
          }
        })
      })
      setPlugins(nextPlugins)
      if (failedIndex.length > 0)
        setErrorIndexes([...errorIndexes, ...failedIndex])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingDataByMeta])

  useEffect(() => {
    // get info all failed
    if (infoByMetaError || infoByIdError)
      setErrorIndexes([...errorIndexes, ...marketPlaceInDSLIndex])

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [infoByMetaError, infoByIdError])

  const isLoadedAllData = (plugins.filter(p => !!p).length + errorIndexes.length) === allPlugins.length
  useEffect(() => {
    if (isLoadedAllData)
      onLoadedAllPlugin()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadedAllData])

  const handleSelect = useCallback((index: number) => {
    return () => {
      onSelect(plugins[index]!, index)
    }
  }, [onSelect, plugins])
  return (
    <>
      {allPlugins.map((d, index) => {
        if (errorIndexes.includes(index)) {
          return (
            <LoadingError key={index} />
          )
        }
        if (d.type === 'github') {
          return (<GithubItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            dependency={d as GitHubItemAndMarketPlaceDependency}
            onFetchedPayload={handleGitHubPluginFetched(index)}
            onFetchError={handleGitHubPluginFetchError(index)}
          />)
        }

        if (d.type === 'marketplace') {
          return (
            <MarketplaceItem
              key={index}
              checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
              onCheckedChange={handleSelect(index)}
              payload={plugins[index] as Plugin}
            />
          )
        }

        return (
          <PackageItem
            key={index}
            checked={!!selectedPlugins.find(p => p.plugin_id === plugins[index]?.plugin_id)}
            onCheckedChange={handleSelect(index)}
            payload={d as PackageDependency}
          />
        )
      })
      }
    </>
  )
}
export default React.memo(InstallByDSLList)
